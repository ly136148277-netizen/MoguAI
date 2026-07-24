const path = require("node:path");
const { planChangeScope, parseAllowPaths } = require("../../skills/coding-scope");
const { planEditAccuracy } = require("../../skills/coding-accuracy");
const { RepoIndex, canonicalRoot } = require("../intelligence/repo-index");
const { discoverTests } = require("../intelligence/test-discovery");
const { LspManager } = require("../intelligence/lsp-manager");
const { classifyTask } = require("./task-classifier");
const { configHash, deepFreeze, isPlainObject } = require("./contracts");

const SCHEMA_VERSION = "2.2";
const MAX_HYPOTHESES = 12;
const MAX_EVIDENCE = 200;
const MAX_SUBTASKS = 2;
const FORBIDDEN_EXPLORATION_CAPABILITIES = new Set(["write", "commit", "push", "install"]);

function boundedString(value, max = 2_000) {
  return String(value == null ? "" : value).replace(/\0/g, "").slice(0, max);
}

function boundedNumber(value, fallback, min, max, integer = true) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const bounded = Math.min(max, Math.max(min, number));
  return integer ? Math.floor(bounded) : bounded;
}

function boundedJson(value, depth = 0) {
  if (depth > 5 || value === undefined) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return boundedString(value, 4_000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => boundedJson(item, depth + 1));
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const [key, child] of Object.entries(value).slice(0, 50)) {
    out[boundedString(key, 128)] = boundedJson(child, depth + 1);
  }
  return out;
}

function normalizeRelative(root, value, { allowMissing = true } = {}) {
  const raw = boundedString(value, 1_024).replace(/\\/g, "/").trim();
  if (!raw || path.posix.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)) {
    const error = new Error("path escapes workspace");
    error.code = "path_escape";
    throw error;
  }
  const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    const error = new Error("path escapes workspace");
    error.code = "path_escape";
    throw error;
  }
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const error = new Error("path escapes workspace");
    error.code = "path_escape";
    throw error;
  }
  if (!allowMissing) {
    const resolved = require("node:fs").realpathSync(absolute);
    const realRelative = path.relative(root, resolved);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      const error = new Error("path escapes workspace");
      error.code = "path_escape";
      throw error;
    }
  }
  return normalized;
}

function normalizePaths(root, values, max = 40) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeRelative(root, value);
    if (!out.includes(normalized)) out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeVerifyStages(stages) {
  if (!Array.isArray(stages)) return [];
  return stages.slice(0, 16).map((stage, index) => ({
    name: boundedString(stage?.name || `verify:${index + 1}`, 120),
    command: boundedString(stage?.command, 2_000),
  })).filter((stage) => stage.command);
}

function normalizeBudgets(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    maxInputTokens: boundedNumber(source.maxInputTokens, null, 0, 10_000_000),
    maxOutputTokens: boundedNumber(source.maxOutputTokens, null, 0, 1_000_000),
    maxToolCalls: boundedNumber(source.maxToolCalls, 20, 0, 1_000),
    maxSteps: boundedNumber(source.maxSteps, 24, 1, 1_000),
    maxRepairIterations: boundedNumber(source.maxRepairIterations, 2, 0, 20),
    maxWallTimeMs: boundedNumber(source.maxWallTimeMs, 480_000, 1_000, 7_200_000),
    maxCostUsd: boundedNumber(source.maxCostUsd, null, 0, 1_000_000, false),
    maxRepoFiles: boundedNumber(source.maxRepoFiles, 2_000, 1, 10_000),
    maxEvidenceItems: boundedNumber(source.maxEvidenceItems, 100, 1, MAX_EVIDENCE),
  };
}

function normalizeExplorationSubtasks(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_SUBTASKS).map((item, index) => {
    const capabilities = [...new Set(
      (Array.isArray(item?.capabilities) ? item.capabilities : ["read", "search"])
        .map((capability) => boundedString(capability, 32).toLowerCase())
        .filter(Boolean)
    )];
    if (capabilities.some((capability) => FORBIDDEN_EXPLORATION_CAPABILITIES.has(capability))) {
      const error = new Error("Exploration subtasks must be read-only");
      error.code = "read_only";
      throw error;
    }
    return {
      id: boundedString(item?.id || `explore-${index + 1}`, 100),
      description: boundedString(item?.description, 2_000),
      payload: boundedJson(isPlainObject(item?.payload) ? item.payload : {}),
      capabilities: capabilities.length ? capabilities : ["read", "search"],
      readOnly: true,
    };
  });
}

function summarizePlan(plan) {
  if (!plan) return null;
  return deepFreeze({
    schemaVersion: plan.schemaVersion,
    planId: plan.planId,
    taskId: plan.taskId,
    taskClass: plan.classification.taskClass,
    targetFiles: plan.scope.allowedPaths,
    verifyStages: plan.verifyStages,
    lspStatus: plan.lsp.status,
    contentHash: plan.hashes.content,
  });
}

function evidenceForTargets(index, targets, symbols, limit) {
  const stats = index.stats();
  const evidence = [{
    kind: "index-summary",
    source: "static-index",
    files: stats.files,
    symbols: stats.symbols,
    callEdges: stats.callEdges,
  }];
  const add = (item) => {
    if (evidence.length < limit) evidence.push(item);
  };
  const symbolSet = new Set(symbols);
  for (const target of targets) {
    const imports = index.getImports(target);
    add({
      kind: "file",
      source: "static-index",
      file: target,
      imports: imports.paths.slice(0, 12),
      importers: index.getImporters(target).slice(0, 12),
    });
    for (const definition of index.getSymbols(target).slice(0, 30)) {
      symbolSet.add(definition.name);
      const { kind: symbolKind, ...location } = definition;
      add({ kind: "definition", source: "static-index", symbol: definition.name, symbolKind, ...location });
    }
  }
  for (const symbol of [...symbolSet].slice(0, 30)) {
    for (const definition of index.findDefinitions(symbol).slice(0, 10)) {
      if (!evidence.some((item) =>
        item.kind === "definition" &&
        item.file === definition.file &&
        item.line === definition.line &&
        item.symbol === symbol
      )) {
        const { kind: symbolKind, ...location } = definition;
        add({ kind: "definition", source: "static-index", symbol, symbolKind, ...location });
      }
    }
    for (const reference of index.findReferences(symbol, { limit: 20 })) {
      add({ kind: "reference", source: "static-index", symbol, ...reference });
    }
  }
  return evidence;
}

function validateRegisteredLsp(config, root) {
  if (!config) return { ok: false, status: "UNAVAILABLE", reason: "not_configured" };
  if (!isPlainObject(config) || config.registeredByUser !== true) {
    return { ok: false, status: "BLOCKED", reason: "not_user_registered" };
  }
  if (!boundedString(config.version, 120)) {
    return { ok: false, status: "BLOCKED", reason: "version_pin_missing" };
  }
  if (!boundedString(config.licenseEvidenceId, 200)) {
    return { ok: false, status: "BLOCKED", reason: "license_evidence_missing" };
  }
  if (!boundedString(config.command, 2_000)) {
    return { ok: false, status: "BLOCKED", reason: "command_missing" };
  }
  if (!Array.isArray(config.args)) {
    return { ok: false, status: "BLOCKED", reason: "args_invalid" };
  }
  let allowedRoot;
  try {
    allowedRoot = canonicalRoot(config.allowedWorkspaceRoot);
  } catch {
    return { ok: false, status: "BLOCKED", reason: "allowed_workspace_invalid" };
  }
  if (allowedRoot.toLowerCase() !== root.toLowerCase()) {
    return { ok: false, status: "BLOCKED", reason: "workspace_not_allowed" };
  }
  return {
    ok: true,
    config: {
      id: boundedString(config.id, 120),
      command: boundedString(config.command, 2_000),
      args: config.args.slice(0, 64).map((arg) => boundedString(arg, 2_000)),
      version: boundedString(config.version, 120),
      licenseEvidenceId: boundedString(config.licenseEvidenceId, 200),
      allowedWorkspaceRoot: allowedRoot,
      workspace: root,
    },
  };
}

class NeuralPlanner {
  constructor(options = {}) {
    this.getSettings = options.getSettings || (async () => options.settings || {});
    this.getLspServers = options.getLspServers || null;
    this.eventStore = options.eventStore || null;
    this.subtaskCoordinator = options.subtaskCoordinator || null;
    this.subtaskCoordinatorFactory = options.subtaskCoordinatorFactory || null;
    this.repoIndexFactory = options.repoIndexFactory || ((workspace, indexOptions) => new RepoIndex(workspace, indexOptions));
    this.lspManagerFactory = options.lspManagerFactory || ((config, managerOptions) => new LspManager(config, managerOptions));
    this.clock = options.clock || (() => Date.now());
  }

  async _append(taskId, settings, type, payload) {
    if (!taskId || settings?.v22DecisionTrace !== true || !this.eventStore?.append) return;
    await this.eventStore.append(taskId, { type, source: "neural-planner", payload });
  }

  async _resolveLspConfig(request, settings) {
    const id = boundedString(request.lspServerId, 120);
    if (!id) return null;
    const registered = this.getLspServers
      ? await this.getLspServers()
      : Array.isArray(settings?.v22LspServers) ? settings.v22LspServers : [];
    return (Array.isArray(registered) ? registered : []).find((item) => item?.id === id) || null;
  }

  async _collectLsp(request, settings, root, symbols) {
    const registered = await this._resolveLspConfig(request, settings);
    const checked = validateRegisteredLsp(registered, root);
    if (!checked.ok) {
      return {
        status: checked.status,
        serverId: boundedString(request.lspServerId, 120) || null,
        version: registered?.version || null,
        evidence: [],
        fallbackReason: checked.reason,
      };
    }
    let manager;
    try {
      manager = this.lspManagerFactory(checked.config, {
        workspace: root,
        requestTimeoutMs: boundedNumber(request.lspTimeoutMs, 3_000, 10, 30_000),
        initializeTimeoutMs: boundedNumber(request.lspTimeoutMs, 3_000, 10, 30_000),
      });
      const initialized = await manager.start();
      const evidence = [];
      for (const symbol of symbols.slice(0, 8)) {
        const result = await manager.request("workspace/symbol", { query: symbol });
        evidence.push({
          kind: "workspace-symbol",
          source: "lsp",
          symbol,
          result: boundedJson(Array.isArray(result) ? result.slice(0, 20) : result),
        });
      }
      return {
        status: "AVAILABLE",
        serverId: checked.config.id || boundedString(request.lspServerId, 120),
        version: checked.config.version,
        licenseEvidenceId: checked.config.licenseEvidenceId,
        capabilities: boundedJson(initialized?.capabilities || {}),
        evidence,
        fallbackReason: null,
      };
    } catch (error) {
      return {
        status: "FALLBACK",
        serverId: checked.config.id || boundedString(request.lspServerId, 120),
        version: checked.config.version,
        licenseEvidenceId: checked.config.licenseEvidenceId,
        evidence: [],
        fallbackReason: boundedString(error?.code || error?.message || "lsp_failed", 500),
      };
    } finally {
      await manager?.stop?.().catch(() => {});
    }
  }

  async create(request = {}) {
    const settings = await this.getSettings();
    if (settings?.v22NeuralLayer !== true || settings?.v22Planner !== true) {
      return { ok: true, enabled: false, status: "DISABLED", legacyBehavior: true };
    }
    const root = canonicalRoot(request.workspace);
    const prompt = boundedString(request.prompt || request.text, 24_000);
    const taskId = boundedString(request.taskId || request.moguTaskId || "preview", 160);
    const rawPaths = request.allowPaths || request.scopePaths || request.paths;
    const rawPathList = Array.isArray(rawPaths)
      ? rawPaths
      : typeof rawPaths === "string"
        ? rawPaths.split(/[,;\n]+/)
        : [];
    for (const rawPath of rawPathList) normalizeRelative(root, rawPath);
    const explicit = parseAllowPaths(rawPaths);
    const explicitPaths = normalizePaths(root, explicit);
    const editPlan = planEditAccuracy(root, prompt, { allowPaths: explicitPaths });
    const scopeSource = planChangeScope(root, prompt, {
      allowPaths: explicitPaths.length ? explicitPaths : editPlan.targetPaths,
    });
    const scopePaths = normalizePaths(root, scopeSource.allowedPaths);
    const scope = {
      locked: scopeSource.locked === true,
      allowedPaths: scopePaths,
      source: boundedString(explicitPaths.length ? "explicit" : scopeSource.source, 40),
      confidence: ["high", "medium", "low", "none"].includes(scopeSource.confidence)
        ? scopeSource.confidence
        : "none",
      reason: boundedString(scopeSource.reason, 1_000),
      mustTouch: editPlan.mustTouch.slice(0, 16).map((item) => boundedString(item, 200)),
      targets: editPlan.targets.slice(0, 20).map((target) => ({
        path: normalizeRelative(root, target.path),
        score: boundedNumber(target.score, 0, 0, 10_000, false),
        reason: boundedString(target.reason, 500),
      })),
    };
    const classification = classifyTask({
      text: prompt,
      taskClass: request.taskClass || "coding",
      complexity: request.complexity,
      requiredCapabilities: request.requiredCapabilities,
    });
    const budgets = normalizeBudgets({ ...(settings?.v22Config?.budget || {}), ...(request.budgets || {}) });
    const index = this.repoIndexFactory(root, { maxFiles: budgets.maxRepoFiles });
    const indexStats = index.update();
    const staticEvidence = evidenceForTargets(
      index,
      scopePaths,
      editPlan.mustTouch,
      budgets.maxEvidenceItems
    );
    const discovered = discoverTests(root, { maxFiles: budgets.maxRepoFiles });
    const explicitVerifyStages = request.verifyStages ?? request.patchVerifyStages;
    const verifyStages = explicitVerifyStages !== undefined
      ? normalizeVerifyStages(explicitVerifyStages)
      : normalizeVerifyStages(discovered.verifyStages);
    const lsp = await this._collectLsp(request, settings, root, editPlan.mustTouch);
    const requestedSubtasks = normalizeExplorationSubtasks(request.explorationSubtasks);
    let exploration = { status: requestedSubtasks.length ? "UNAVAILABLE" : "NOT_REQUESTED", results: [] };
    let coordinator = this.subtaskCoordinator;
    if (requestedSubtasks.length && !coordinator && this.subtaskCoordinatorFactory) {
      try {
        coordinator = await this.subtaskCoordinatorFactory(request, root);
      } catch (error) {
        exploration = {
          status: "UNAVAILABLE",
          fallbackReason: boundedString(error?.code || error?.message, 500),
          results: [],
        };
      }
    }
    if (requestedSubtasks.length && coordinator?.join) {
      try {
        const joined = await coordinator.join(taskId, requestedSubtasks, {
          joinId: boundedString(request.explorationJoinId, 160) || undefined,
          permission: { read: true, search: true, write: false, commit: false, push: false, install: false },
        });
        exploration = {
          status: joined.ok ? "COMPLETED" : "PARTIAL",
          joinId: boundedString(joined.joinId, 160),
          results: boundedJson((joined.results || []).slice(0, MAX_SUBTASKS)),
        };
      } catch (error) {
        exploration = {
          status: "UNAVAILABLE",
          fallbackReason: boundedString(error?.code || error?.message, 500),
          results: [],
        };
      }
    }
    const hypotheses = scope.targets.slice(0, MAX_HYPOTHESES).map((target, indexValue) => ({
      id: `hypothesis-${indexValue + 1}`,
      text: boundedString(`Changes are required in ${target.path}: ${target.reason}`, 1_000),
      targetFiles: [target.path],
      confidence: Math.min(1, Math.max(0, target.score / 100)),
      evidence: staticEvidence
        .filter((item) => item.file === target.path)
        .slice(0, 20),
    }));
    if (!hypotheses.length) {
      hypotheses.push({
        id: "hypothesis-1",
        text: "Repository exploration is required before selecting edit targets",
        targetFiles: [],
        confidence: 0,
        evidence: staticEvidence.slice(0, 20),
      });
    }
    const createdAt = new Date(this.clock()).toISOString();
    const content = {
      schemaVersion: SCHEMA_VERSION,
      taskId,
      classification,
      hypotheses,
      scope,
      repoEvidence: {
        source: "static-index",
        index: indexStats,
        items: staticEvidence,
        tests: {
          frameworks: discovered.frameworks.slice(0, 20),
          files: discovered.tests.slice(0, 200),
        },
        lspItems: lsp.evidence,
        explorationItems: exploration.results,
      },
      verifyStages,
      explorationSubtasks: {
        requested: requestedSubtasks,
        ...exploration,
        maxParallel: MAX_SUBTASKS,
        readOnly: true,
      },
      lsp,
      budgets,
      failurePolicy: {
        preserveStaticEvidence: true,
        stopOnPathEscape: true,
        noInstall: true,
        lspFallback: "static-index",
      },
      replanPolicy: {
        maxReplans: boundedNumber(request.maxReplans, 2, 0, 10),
        triggers: ["scope_violation", "verification_failure", "evidence_conflict"],
        executionOwnedElsewhere: true,
      },
    };
    const contentHash = configHash(content);
    const planId = `neural-plan-${contentHash.slice(0, 24)}`;
    const plan = deepFreeze({
      ...content,
      planId,
      hashes: {
        algorithm: "sha256",
        content: contentHash,
        plan: configHash({ ...content, planId }),
      },
      timestamps: {
        createdAt,
        expiresAt: new Date(this.clock() + budgets.maxWallTimeMs).toISOString(),
      },
    });
    await this._append(taskId, settings, "neural.plan", summarizePlan(plan));
    if (lsp.fallbackReason) {
      await this._append(taskId, settings, "neural.lsp_fallback", {
        planId,
        status: lsp.status,
        reason: lsp.fallbackReason,
      });
    }
    return plan;
  }

  async preview(request = {}) {
    const plan = await this.create(request);
    return plan?.enabled === false ? plan : { ok: true, enabled: true, plan };
  }
}

module.exports = {
  NeuralPlanner,
  SCHEMA_VERSION,
  MAX_SUBTASKS,
  normalizeRelative,
  normalizeVerifyStages,
  normalizeBudgets,
  normalizeExplorationSubtasks,
  validateRegisteredLsp,
  summarizePlan,
  createNeuralPlan: (request, options) => new NeuralPlanner(options).create(request),
};

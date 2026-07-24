const crypto = require("node:crypto");
const { sanitizeV22Config } = require("../../settings");
const { createOpenAiCompatibleAdapter, BrainAdapterError, ERROR_CODES } = require("../../brain/openai-compatible-adapter");
const { classifyTask } = require("./task-classifier");
const { ModelRegistry } = require("./model-registry");
const { ModelRouter } = require("./model-router");
const { BudgetLedger } = require("./budget-ledger");
const { NeuralPlanner } = require("./planner");
const { OUTCOMES, REASONS, blocked, configHash } = require("./contracts");

const NON_FALLBACK_CODES = new Set([
  "BLOCKED",
  "INVALID_CONFIG",
  "MODEL_MISMATCH",
  "PERMISSION_DENIED",
  "SAFETY_BLOCKED",
  "REQUEST_TOO_LARGE",
  "TOOL_ARGUMENTS_TOO_LARGE",
]);

function routingEnabled(settings) {
  return settings?.v22NeuralLayer === true && settings?.v22ModelRouting === true;
}

function safeId(value, prefix = "route") {
  const text = String(value || "").replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 160);
  return text || `${prefix}-${crypto.randomUUID()}`;
}

function estimateTokens(messages) {
  const chars = (Array.isArray(messages) ? messages : [])
    .map((message) => String(message?.content || ""))
    .join("").length;
  return Math.max(1, Math.ceil(chars / 4));
}

function priceUsage(profile, usage = {}) {
  const inputTokens = Number(usage.inputTokens ?? usage.promptTokens ?? 0) || 0;
  const outputTokens = Number(usage.outputTokens ?? usage.completionTokens ?? 0) || 0;
  const result = {
    requests: 1,
    inputTokens,
    outputTokens,
    tokens: Number(usage.tokens ?? usage.totalTokens ?? inputTokens + outputTokens) || 0,
    toolCalls: Number(usage.toolCalls ?? 0) || 0,
    wallTimeMs: Number(usage.wallTimeMs ?? usage.latencyMs ?? 0) || 0,
  };
  if (profile?.pricing) {
    result.estimatedCostUsd =
      (inputTokens * profile.pricing.inputPerMillion +
        outputTokens * profile.pricing.outputPerMillion) /
      1_000_000;
  }
  return result;
}

function adapterConfigFromProfile(profile, budget = {}) {
  const capabilities = new Set(profile.capabilities || []);
  const configuredLimits = profile.limits && typeof profile.limits === "object" ? profile.limits : {};
  const maxOutputTokens = Math.min(
    profile.maxOutputTokens,
    Number.isFinite(budget.maxOutputTokens) ? budget.maxOutputTokens : profile.maxOutputTokens
  );
  return {
    provider: profile.provider,
    endpoint: profile.endpoint,
    modelId: profile.modelId,
    secretId: profile.secretId,
    capabilities: {
      tools: capabilities.has("tools"),
      jsonMode: capabilities.has("json") || capabilities.has("jsonMode"),
    },
    sampling: {
      temperature: Number.isFinite(configuredLimits.temperature) ? configuredLimits.temperature : 0.3,
      topP: Number.isFinite(configuredLimits.topP) ? configuredLimits.topP : null,
      seed: Number.isSafeInteger(configuredLimits.seed) ? configuredLimits.seed : null,
    },
    limits: {
      timeoutMs: configuredLimits.timeoutMs,
      maxSteps: Number.isFinite(budget.maxSteps) ? budget.maxSteps : configuredLimits.maxSteps,
      maxOutputTokens,
      maxRequestBytes: configuredLimits.maxRequestBytes,
      maxResponseBytes: configuredLimits.maxResponseBytes,
      maxToolArgumentsBytes: configuredLimits.maxToolArgumentsBytes,
      maxCostUsd: Number.isFinite(budget.maxCostUsd) ? budget.maxCostUsd : null,
    },
    network: {
      allowPrivateNetwork: /^http:\/\/(?:localhost|127\.|\\?\[?::1)/i.test(profile.endpoint),
      allowInsecureLocalhost: /^http:\/\/(?:localhost|127\.|\\?\[?::1)/i.test(profile.endpoint),
    },
  };
}

function cleanLimits(limits) {
  return Object.fromEntries(Object.entries(limits).filter(([, value]) => value != null));
}

function publicDecision(decision) {
  if (!decision || typeof decision !== "object") return null;
  if (decision.status !== OUTCOMES.SELECTED) {
    return {
      status: decision.status || OUTCOMES.BLOCKED,
      reason: decision.reason || null,
      configHash: decision.configHash || null,
      policyId: decision.policyId || null,
      rejectedCandidates: decision.rejectedCandidates || [],
    };
  }
  return {
    status: decision.status,
    decisionId: decision.decisionId,
    profileId: decision.primaryProfile.id,
    provider: decision.primaryProfile.provider,
    modelId: decision.primaryProfile.modelId,
    policyId: decision.policyId,
    configHash: decision.configHash,
    allowModelFallback: decision.allowModelFallback === true,
    alternatives: decision.alternatives.map((candidate) => candidate.profile.id),
    rejectedCandidates: decision.rejectedCandidates,
  };
}

function errorCode(error) {
  if (error?.accepted === true) return "BLOCKED";
  if (error?.code === ERROR_CODES.BLOCKED && /unexpected model/i.test(error?.message || "")) {
    return REASONS.MODEL_MISMATCH;
  }
  return String(error?.code || error?.reason?.code || "CALL_FAILED");
}

class NeuralRoutingService {
  constructor(options = {}) {
    this.getSettings = options.getSettings || (async () => options.settings || {});
    this.secretStore = options.secretStore || null;
    this.keyResolver = options.keyResolver || ((secretId) => this.secretStore?.get?.(secretId));
    this.taskStore = options.taskStore || null;
    this.eventStore = options.eventStore || options.runEventStore || null;
    this.ledger = options.ledger || options.budgetLedger || null;
    this.ledgerRoot = options.ledgerRoot || null;
    this.adapterFactory = options.adapterFactory || createOpenAiCompatibleAdapter;
    this.fetchImpl = options.fetchImpl;
    this.clock = options.clock || (() => Date.now());
  }

  async _context() {
    const settings = await this.getSettings();
    const config = sanitizeV22Config(settings?.v22Config);
    const registry = new ModelRegistry(config);
    const router = new ModelRouter(registry, config);
    const ledger =
      this.ledger ||
      (this.ledgerRoot
        ? new BudgetLedger({ root: this.ledgerRoot, file: "budget-ledger.json" })
        : null);
    return { settings, config, registry, router, ledger };
  }

  async status() {
    const { settings, config, registry, router } = await this._context();
    const availableSecretIds = await this._availableSecretIds(registry);
    return {
      ok: true,
      enabled: routingEnabled(settings),
      fallbackEnabled: config.allowModelFallback === true,
      profileCount: registry.list().length,
      availableProfileCount: registry
        .list()
        .filter((profile) => !availableSecretIds || availableSecretIds.includes(profile.secretId))
        .length,
      invalidProfiles: registry.invalidProfiles(),
      policyCount: router.policies.length,
      configHash: router._configHash,
    };
  }

  async preview(request = {}) {
    const context = await this._context();
    if (!routingEnabled(context.settings)) {
      return { ok: true, enabled: false, status: "DISABLED", legacyBehavior: true };
    }
    const classification = request.classification || classifyTask({
      text: request.text || "",
      hints: { taskClass: request.taskClass || undefined },
      requiredCapabilities: request.requiredCapabilities || [],
    });
    const runId = safeId(request.runId || request.moguTaskId || "preview");
    const snapshot = context.ledger ? await context.ledger.snapshot(runId) : { status: "OK" };
    const constraints = this._constraints(request, context.config);
    constraints.availableSecretIds = await this._availableSecretIds(context.registry);
    const decision = context.router.route(classification, constraints, snapshot);
    return { ok: decision.status === OUTCOMES.SELECTED, enabled: true, ...publicDecision(decision), classification };
  }

  _constraints(request, config) {
    const input = Number(request.estimatedInputTokens);
    const output = Number(request.estimatedOutputTokens);
    return {
      policyId: request.policyId,
      requiredCapabilities: request.requiredCapabilities || [],
      estimatedInputTokens: Number.isFinite(input) ? input : estimateTokens(request.messages),
      estimatedOutputTokens: Number.isFinite(output)
        ? output
        : Math.min(Number(config.budget.maxOutputTokens) || 1024, 1024),
      maxCostUsd: config.budget.maxCostUsd,
    };
  }

  async _availableSecretIds(registry) {
    if (!this.secretStore?.hasReference) return null;
    const ids = [];
    for (const profile of registry.list({ includeDisabled: true })) {
      if (await this.secretStore.hasReference(profile.secretId)) ids.push(profile.secretId);
    }
    return ids;
  }

  async _append(taskId, settings, type, payload) {
    if (!taskId || settings.v22DecisionTrace !== true || !this.eventStore?.append) return null;
    const appended = await this.eventStore.append(taskId, {
      type,
      source: "routing",
      payload,
    });
    if (this.taskStore?.update) {
      await this.taskStore.update(taskId, {
        runtimeEventRef: appended.ref,
        runtimeEventSummary: appended.ref,
      });
    }
    return appended;
  }

  async _ensureTask(request, routing) {
    if (request.createTask === false) return request.moguTaskId || null;
    if (request.moguTaskId || !this.taskStore?.create) return request.moguTaskId || null;
    const task = await this.taskStore.create({
      source: request.taskClass === "coding" ? "coding" : "brain",
      kind: `neural.${request.taskClass || "chat"}`,
      executor: "neural-router",
      name: request.name || `Neural route:${request.taskClass || "chat"}`,
      status: "running",
      requestText: String(request.text || "").slice(0, 12000),
      routing,
    });
    return task.moguTaskId;
  }

  async execute(request = {}, invoke) {
    if (typeof invoke !== "function") throw new TypeError("routing invoke callback is required");
    const context = await this._context();
    if (!routingEnabled(context.settings)) {
      return invoke({ legacy: true, enabled: false });
    }
    const classification = request.classification || classifyTask({
      text: request.text || "",
      hints: { taskClass: request.taskClass || undefined },
      requiredCapabilities: request.requiredCapabilities || [],
    });
    const runId = safeId(request.runId || request.moguTaskId, request.taskClass || "route");
    const snapshot = context.ledger ? await context.ledger.snapshot(runId) : { status: "OK" };
    const constraints = this._constraints(request, context.config);
    constraints.availableSecretIds = await this._availableSecretIds(context.registry);
    const decision = context.router.route(classification, constraints, snapshot);
    const routing = publicDecision(decision);
    let taskId = await this._ensureTask(request, routing);
    if (this.taskStore?.update && taskId) {
      await this.taskStore.update(taskId, {
        routing,
        routingConfigHash: decision.configHash || context.router._configHash,
        routingBudgetSnapshot: snapshot,
      });
    }
    await this._append(taskId, context.settings, "routing.decision", {
      ...routing,
      classification,
      budgetSnapshot: snapshot,
    });
    if (decision.status !== OUTCOMES.SELECTED) {
      return { ok: false, status: OUTCOMES.BLOCKED, code: decision.reason?.code, reason: decision.reason, routing, moguTaskId: taskId };
    }

    const attempted = [];
    let profile = decision.primaryProfile;
    let candidate = decision.primary;
    while (profile) {
      const attemptNumber = attempted.length + 1;
      const adapterConfig = adapterConfigFromProfile(profile, context.config.budget);
      adapterConfig.limits = cleanLimits(adapterConfig.limits);
      const estimate = priceUsage(profile, {
        inputTokens: constraints.estimatedInputTokens,
        outputTokens: constraints.estimatedOutputTokens,
      });
      const reserveId = safeId(`${runId}:reserve:${attemptNumber}`);
      const reservation = context.ledger
        ? await context.ledger.reserve({
            runId,
            eventId: reserveId,
            usage: estimate,
            limits: { perRun: context.config.budget },
          })
        : { status: "RESERVED", reservationId: null, run: snapshot.run, daily: snapshot.daily };
      if (reservation.status !== "RESERVED") {
        const result = { ok: false, status: OUTCOMES.BLOCKED, code: reservation.reason?.code, reason: reservation.reason, routing, moguTaskId: taskId };
        await this._append(taskId, context.settings, "routing.attempt", {
          attemptNumber, profileId: profile.id, status: "BLOCKED", reason: reservation.reason,
        });
        return result;
      }

      const attemptBase = {
        attemptNumber,
        profileId: profile.id,
        provider: profile.provider,
        modelId: profile.modelId,
        selected: true,
      };
      await this._append(taskId, context.settings, "routing.attempt", { ...attemptBase, status: "STARTED" });
      try {
        const secret = await this.keyResolver(profile.secretId, {
          provider: profile.provider,
          modelId: profile.modelId,
        });
        if (!String(secret || "").trim()) {
          const missing = new BrainAdapterError(ERROR_CODES.BLOCKED, "Selected model credential is unavailable", {
            provider: profile.provider,
            modelId: profile.modelId,
          });
          missing.code = REASONS.MISSING_SECRET_REFERENCE;
          throw missing;
        }
        const adapter = request.createAdapter === false
          ? null
          : this.adapterFactory(adapterConfig, {
              keyResolver: async () => secret,
              ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
            });
        const started = this.clock();
        const result = await invoke({
          enabled: true,
          profile,
          adapterConfig,
          adapter,
          apiKey: secret,
          endpoint: profile.endpoint,
          provider: profile.provider,
          model: profile.modelId,
          modelId: profile.modelId,
          secretId: profile.secretId,
          decision: routing,
          moguTaskId: taskId,
        });
        if (!taskId && result?.moguTaskId) {
          taskId = result.moguTaskId;
          if (this.taskStore?.update) {
            await this.taskStore.update(taskId, {
              routing,
              routingConfigHash: decision.configHash,
              routingBudgetSnapshot: snapshot,
            });
          }
          await this._append(taskId, context.settings, "routing.decision", {
            ...routing,
            classification,
            budgetSnapshot: snapshot,
          });
          await this._append(taskId, context.settings, "routing.attempt", {
            ...attemptBase,
            status: "STARTED",
          });
        }
        const usage = result?.usage
          ? priceUsage(profile, {
              ...result.usage,
              latencyMs: result?.latencyMs ?? Math.max(0, this.clock() - started),
            })
          : {
              ...estimate,
              wallTimeMs: result?.latencyMs ?? Math.max(0, this.clock() - started),
            };
        const committed = context.ledger && reservation.reservationId
          ? await context.ledger.commit({
              reservationId: reservation.reservationId,
              eventId: safeId(`${runId}:commit:${attemptNumber}`),
              usage,
            })
          : { status: "COMMITTED", usage, run: reservation.run, daily: reservation.daily };
        if (committed.status === OUTCOMES.BLOCKED) {
          return { ok: false, status: OUTCOMES.BLOCKED, code: committed.reason?.code, reason: committed.reason, routing, moguTaskId: taskId };
        }
        attempted.push({ ...attemptBase, status: "COMPLETED" });
        await this._append(taskId, context.settings, "routing.attempt", {
          ...attemptBase,
          status: "COMPLETED",
        });
        const selectedRouting = { ...routing, profileId: profile.id, provider: profile.provider, modelId: profile.modelId, attempts: attempted };
        if (this.taskStore?.update && taskId) {
          await this.taskStore.update(taskId, {
            routing: selectedRouting,
            routingBudgetSnapshot: { run: committed.run, daily: committed.daily },
          });
        }
        await this._append(taskId, context.settings, "routing.usage", {
          profileId: profile.id,
          usage: committed.usage || usage,
          budgetSnapshot: { run: committed.run, daily: committed.daily },
        });
        return { ...result, routing: selectedRouting, moguTaskId: result?.moguTaskId || taskId };
      } catch (error) {
        if (!taskId && error?.moguTaskId) taskId = error.moguTaskId;
        if (context.ledger && reservation.reservationId) {
          await context.ledger.release({
            reservationId: reservation.reservationId,
            eventId: safeId(`${runId}:release:${attemptNumber}`),
          });
        }
        const code = errorCode(error);
        attempted.push({ ...attemptBase, status: "FAILED", code });
        await this._append(taskId, context.settings, "routing.attempt", {
          ...attemptBase, status: "FAILED", code, message: String(error?.message || "").slice(0, 500),
        });
        if (NON_FALLBACK_CODES.has(code) || /permission|safety|invalid.?config/i.test(code)) {
          return {
            ok: false,
            status: OUTCOMES.BLOCKED,
            code,
            error: error?.message,
            routing: { ...routing, attempts: attempted },
            moguTaskId: taskId,
          };
        }
        const next = context.router.nextCandidate(decision, {
          code,
          profileId: profile.id,
          attemptedProfileIds: attempted.map((item) => item.profileId),
        });
        if (next.status !== OUTCOMES.NEXT_CANDIDATE) {
          return {
            ok: false,
            status: next.status === OUTCOMES.NO_FALLBACK ? OUTCOMES.BLOCKED : next.status,
            code: next.reason?.code || code,
            error: error?.message,
            reason: next.reason,
            routing: { ...routing, attempts: attempted },
            moguTaskId: taskId,
          };
        }
        profile = next.profile;
        candidate = next.candidate;
      } finally {
        candidate = null;
      }
    }
    return blocked(REASONS.FALLBACK_EXHAUSTED, "No routed model attempt completed");
  }

  async complete(request = {}) {
    return this.execute(request, async ({ adapter, legacy }) => {
      if (legacy) throw new Error("Neural routing is disabled");
      return adapter.complete({
        messages: request.messages || [],
        tools: request.tools || null,
        signal: request.signal || null,
      });
    });
  }
}

module.exports = {
  NeuralRoutingService,
  ModelRegistry,
  ModelRouter,
  BudgetLedger,
  NeuralPlanner,
  ...require("./planner"),
  ...require("./context-budget"),
  ...require("./tool-chain"),
  ...require("./decision-trace"),
  ...require("./closed-loop"),
  routingEnabled,
  adapterConfigFromProfile,
  publicDecision,
  priceUsage,
  NON_FALLBACK_CODES,
  configHash,
};

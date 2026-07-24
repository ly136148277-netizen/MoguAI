const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  NeuralPlanner,
  normalizeExplorationSubtasks,
  validateRegisteredLsp,
} = require("../src/main/moguai/neural/planner");
const coding = require("../src/main/skills/handlers/coding");
const { sanitizeV22LspServers } = require("../src/main/settings");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-neural-plan-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "tests"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "math.js"), [
    "function add(a, b) { return a + b; }",
    "function twice(value) { return add(value, value); }",
    "module.exports = { add, twice };",
  ].join("\n"));
  await fs.writeFile(path.join(root, "tests", "math.test.js"), [
    "const { add } = require('../src/math');",
    "if (add(1, 2) !== 3) throw new Error('bad');",
  ].join("\n"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    scripts: { test: "node --test tests/*.test.js" },
  }));
  return root;
}

function enabledSettings(overrides = {}) {
  return {
    v22NeuralLayer: true,
    v22Planner: true,
    v22DecisionTrace: false,
    v22Config: { budget: {} },
    ...overrides,
  };
}

test("NeuralPlan is fixed, immutable, bounded, deterministic, and IPC-safe", async () => {
  const root = await fixture();
  try {
    const make = () => new NeuralPlanner({
      settings: enabledSettings(),
      clock: () => Date.parse("2026-07-24T00:00:00.000Z"),
    });
    const request = {
      workspace: root,
      taskId: "task-1",
      prompt: "Fix add in src/math.js and update its test",
      allowPaths: ["src/math.js", "tests/math.test.js"],
      budgets: { maxToolCalls: 999999, maxSteps: -1 },
    };
    const first = await make().create(request);
    const second = await make().create(request);
    assert.equal(first.schemaVersion, "2.2");
    assert.equal(first.planId, second.planId);
    assert.deepEqual(first.hashes, second.hashes);
    assert.equal(first.budgets.maxToolCalls, 1000);
    assert.equal(first.budgets.maxSteps, 1);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.scope.allowedPaths), true);
    assert.equal(JSON.parse(JSON.stringify(first)).planId, first.planId);
    assert.ok(first.verifyStages.some((stage) => stage.command === "npm test"));
    assert.ok(first.repoEvidence.items.some((item) => item.kind === "definition" && item.symbol === "add"));
    assert.ok(first.repoEvidence.items.some((item) => item.kind === "reference" && item.symbol === "add"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("NeuralPlan rejects scope paths escaping the workspace", async () => {
  const root = await fixture();
  try {
    const planner = new NeuralPlanner({ settings: enabledSettings() });
    await assert.rejects(
      planner.create({ workspace: root, prompt: "fix", allowPaths: ["../outside.js"] }),
      (error) => error.code === "path_escape"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("explicit verify stages override discovery, including an explicit empty list", async () => {
  const root = await fixture();
  try {
    const planner = new NeuralPlanner({ settings: enabledSettings() });
    const explicit = await planner.create({
      workspace: root,
      prompt: "fix add",
      verifyStages: [{ name: "caller", command: "node custom.js" }],
    });
    assert.deepEqual(explicit.verifyStages, [{ name: "caller", command: "node custom.js" }]);
    const empty = await planner.create({ workspace: root, prompt: "fix add", verifyStages: [] });
    assert.deepEqual(empty.verifyStages, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("LSP requires explicit registration, version, license evidence, and allowed root", async () => {
  const root = await fixture();
  try {
    assert.equal(validateRegisteredLsp({ registeredByUser: true }, root).reason, "version_pin_missing");
    assert.equal(validateRegisteredLsp({
      registeredByUser: true,
      version: "1.0.0",
      command: "server",
      args: [],
      allowedWorkspaceRoot: root,
    }, root).reason, "license_evidence_missing");
    assert.equal(validateRegisteredLsp({
      registeredByUser: true,
      version: "1.0.0",
      licenseEvidenceId: "notice-1",
      command: "server",
      args: [],
      allowedWorkspaceRoot: path.dirname(root),
    }, root).reason, "workspace_not_allowed");

    const planner = new NeuralPlanner({
      settings: enabledSettings({
        v22LspServers: [{
          id: "bad",
          registeredByUser: true,
          command: "server",
          args: [],
          allowedWorkspaceRoot: root,
        }],
      }),
    });
    const plan = await planner.create({ workspace: root, prompt: "fix add", lspServerId: "bad" });
    assert.equal(plan.lsp.status, "BLOCKED");
    assert.equal(plan.lsp.fallbackReason, "version_pin_missing");
    assert.ok(plan.repoEvidence.items.length > 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("LSP crash falls back without losing static evidence and traces the fallback", async () => {
  const root = await fixture();
  try {
    const events = [];
    const config = {
      id: "fixture",
      registeredByUser: true,
      command: "fixture-lsp",
      args: ["--stdio"],
      version: "1.2.3",
      licenseEvidenceId: "third-party-notice-1",
      allowedWorkspaceRoot: root,
    };
    const planner = new NeuralPlanner({
      settings: enabledSettings({ v22DecisionTrace: true, v22LspServers: [config] }),
      eventStore: { append: async (taskId, event) => events.push({ taskId, ...event }) },
      lspManagerFactory: () => ({
        start: async () => { throw Object.assign(new Error("crashed"), { code: "lsp_crash" }); },
        stop: async () => {},
      }),
    });
    const plan = await planner.create({
      workspace: root,
      taskId: "trace-task",
      prompt: "fix add",
      lspServerId: "fixture",
    });
    assert.equal(plan.lsp.status, "FALLBACK");
    assert.equal(plan.lsp.fallbackReason, "lsp_crash");
    assert.ok(plan.repoEvidence.items.some((item) => item.source === "static-index"));
    assert.ok(events.some((event) => event.type === "neural.plan"));
    assert.ok(events.some((event) => event.type === "neural.lsp_fallback"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("exploration is capped at two and coordinator receives read-only capabilities", async () => {
  const root = await fixture();
  try {
    let received;
    const planner = new NeuralPlanner({
      settings: enabledSettings(),
      subtaskCoordinator: {
        join: async (_taskId, subtasks, options) => {
          received = { subtasks, options };
          return {
            ok: true,
            joinId: "join-1",
            results: subtasks.map((subtask) => ({ id: subtask.id, ok: true, result: { evidence: subtask.id } })),
          };
        },
      },
    });
    const plan = await planner.create({
      workspace: root,
      prompt: "fix add",
      explorationSubtasks: [
        { id: "one", description: "definitions" },
        { id: "two", description: "references" },
        { id: "three", description: "ignored" },
      ],
    });
    assert.equal(received.subtasks.length, 2);
    assert.equal(received.options.permission.write, false);
    assert.ok(received.subtasks.every((subtask) => subtask.readOnly));
    assert.equal(plan.explorationSubtasks.results.length, 2);
    assert.throws(
      () => normalizeExplorationSubtasks([{ capabilities: ["read", "commit"] }]),
      (error) => error.code === "read_only"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("flag-off planScope preserves the legacy result and flag-on returns NeuralPlan preview", async () => {
  const root = await fixture();
  try {
    const args = { workspace: root, prompt: "fix add in src/math.js" };
    const legacy = await coding.planScope({ deps: { settings: {} }, args });
    assert.equal(legacy.provenance, true);
    assert.equal(legacy.plan, undefined);

    let called = 0;
    const preview = await coding.planScope({
      deps: {
        settings: enabledSettings(),
        neuralPlanner: {
          preview: async (request) => {
            called += 1;
            return { ok: true, enabled: true, plan: { schemaVersion: "2.2", workspace: request.workspace } };
          },
        },
      },
      args,
    });
    assert.equal(called, 1);
    assert.equal(preview.plan.schemaVersion, "2.2");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("registered LSP settings are bounded and Factory exposes read-only plan preview IPC", async () => {
  const servers = sanitizeV22LspServers([{
    id: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    version: "4.3.3",
    licenseEvidenceId: "notice-typescript-language-server",
    allowedWorkspaceRoot: "D:\\repo",
    registeredByUser: true,
    token: "must-not-survive",
  }]);
  assert.deepEqual(Object.keys(servers[0]).sort(), [
    "allowedWorkspaceRoot",
    "args",
    "command",
    "id",
    "licenseEvidenceId",
    "registeredByUser",
    "version",
  ]);
  const mainSource = await fs.readFile(path.join(__dirname, "..", "src", "main", "main.js"), "utf8");
  const preloadSource = await fs.readFile(path.join(__dirname, "..", "src", "preload", "preload.js"), "utf8");
  assert.match(mainSource, /ipcMain\.handle\("factory:neural-plan-preview"/);
  assert.match(preloadSource, /factoryNeuralPlanPreview[\s\S]*factory:neural-plan-preview/);
});

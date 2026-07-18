const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { SkillRuntime } = require("../src/main/skills/runtime");
const { listSkillDefs, getSkillDef, mergeEnabled, SKILL_IDS } = require("../src/main/skills/registry");
const { TaskStore } = require("../src/main/task-store");
const { PermissionProxy } = require("../src/main/openclaw/permissions");
const { buildCommand } = require("../src/main/skills/handlers/pc");

function mockPaiBridge(overrides = {}) {
  return {
    ping: async () => true,
    resolvePaiRoot: () => path.join(os.tmpdir(), "mogu-skill-pai"),
    fetchCatalog: async () => ({ workflows: [{ id: "demo" }] }),
    run: async (_s, command) => ({ ok: true, command }),
    runStudio: async (_s, payload) => ({ ok: true, path: "C:\\out\\a.mp4", promptId: "p1", ...payload }),
    ...overrides,
  };
}

function mockOllama(overrides = {}) {
  return {
    getStatus: async () => ({ installed: true, running: true, models: ["a"] }),
    listModels: async () => [{ name: "a" }],
    importModel: async () => ({ ollamaName: "a", skipped: true }),
    ...overrides,
  };
}

async function makeRuntime(extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-skills-"));
  const taskStore = new TaskStore(path.join(dir, "tasks.json"));
  const permissionProxy = new PermissionProxy({
    isDesktopOnline: () => true,
    hasConfirmUi: () => true,
    askUser: (req) => {
      // auto-approve for tests
      setTimeout(() => permissionProxy.respond(req.requestId, true, "test"), 0);
    },
    timeoutMs: 5000,
  });
  const settings = {
    skillsEnabled: mergeEnabled(null),
    paiRoot: path.join(dir, "pai"),
  };
  const runtime = new SkillRuntime({
    taskStore,
    permissionProxy,
    paiBridge: mockPaiBridge(),
    ollama: mockOllama(),
    studioStore: { load: async () => ({ t2iWorkflow: "t2i.json", i2vWorkflow: "i2v.json" }) },
    userDataPath: dir,
    getSettings: async () => settings,
    updateSettings: async (partial) => Object.assign(settings, partial),
    ...extra,
  });
  return { runtime, taskStore, dir, settings, permissionProxy };
}

test("registry lists five mogu skills", () => {
  const defs = listSkillDefs();
  assert.equal(defs.length, 5);
  assert.ok(getSkillDef("mogu.comfy"));
  assert.deepEqual(SKILL_IDS[0], "mogu.comfy");
});

test("pc buildCommand covers open/search/backup", () => {
  assert.equal(buildCommand("open", { app: "ComfyUI" }), "打开 ComfyUI");
  assert.equal(buildCommand("search", { query: "foo" }), "搜索 foo");
  assert.equal(buildCommand("backup", {}), "备份 PAI");
});

test("skills:list returns env and enabled flags", async () => {
  const { runtime } = await makeRuntime();
  const listed = await runtime.list();
  assert.equal(listed.ok, true);
  assert.equal(listed.skills.length, 5);
  assert.equal(listed.skills.every((s) => s.enabled), true);
});

test("disabled skill refuses invoke", async () => {
  const { runtime, settings } = await makeRuntime();
  settings.skillsEnabled["mogu.comfy"] = false;
  const result = await runtime.invoke("mogu.comfy", "list", {}, { skipPermission: true, skipTask: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, "skill_disabled");
});

test("mogu.comfy list creates no task and returns catalog", async () => {
  const { runtime, taskStore } = await makeRuntime();
  const result = await runtime.invoke("mogu.comfy", "list", {}, { skipPermission: true });
  assert.equal(result.ok, true);
  assert.ok(result.catalog);
  const tasks = await taskStore.list({ limit: 10 });
  assert.equal(tasks.length, 0);
});

test("mogu.comfy cancel without promptId needs confirmation", async () => {
  const { runtime } = await makeRuntime();
  const result = await runtime.invoke("mogu.comfy", "cancel", {}, { skipPermission: true });
  assert.equal(result.ok, false);
  assert.equal(result.needsConfirmation, true);
});

test("mogu.studio preflight fails without workflow", async () => {
  const { runtime } = await makeRuntime({
    studioStore: { load: async () => ({}) },
    paiBridge: mockPaiBridge({ ping: async () => true }),
  });
  // stub comfy online via handler preflight — getComfyUiStatus may fail → issue expected
  const result = await runtime.preflight("mogu.studio", {});
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.issues));
});

test("permission deny blocks skill run", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-skills-deny-"));
  const taskStore = new TaskStore(path.join(dir, "tasks.json"));
  const permissionProxy = new PermissionProxy({
    isDesktopOnline: () => false,
    hasConfirmUi: () => false,
    timeoutMs: 1000,
  });
  const runtime = new SkillRuntime({
    taskStore,
    permissionProxy,
    paiBridge: mockPaiBridge(),
    ollama: mockOllama(),
    getSettings: async () => ({ skillsEnabled: mergeEnabled(null) }),
  });
  const result = await runtime.invoke("mogu.pc", "backup", {});
  assert.equal(result.ok, false);
  assert.equal(result.permissionDenied, true);
});

test("SKILL.md files exist for all ids", async () => {
  for (const id of SKILL_IDS) {
    const file = path.join(__dirname, "..", "skills", id, "SKILL.md");
    assert.equal(await fs.pathExists(file), true, file);
  }
});

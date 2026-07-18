const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  buildCodexArgs,
  buildTraeArgs,
  buildBrainEnv,
  probeAll,
  summarizeTrajectory,
  resolveVendorRoots,
} = require("../src/main/skills/coding-engines");
const coding = require("../src/main/skills/handlers/coding");
const { getSkillDef, SKILL_IDS } = require("../src/main/skills/registry");
const { TaskStore } = require("../src/main/task-store");

test("buildBrainEnv reuses one MOGU key for tool subprocesses", () => {
  const { env, hasKey, providerHint } = buildBrainEnv(
    {
      agentApiPreset: "deepseek",
      agentApiBaseUrl: "https://api.deepseek.com/v1",
    },
    "sk-test-brain"
  );
  assert.equal(hasKey, true);
  assert.equal(env.OPENAI_API_KEY, "sk-test-brain");
  assert.equal(env.OPENAI_BASE_URL, "https://api.deepseek.com/v1");
  assert.equal(providerHint, "openai");
  assert.equal(buildBrainEnv({}, "").hasKey, false);
});

test("mogu.coding is registered with coding source", () => {
  assert.ok(SKILL_IDS.includes("mogu.coding"));
  const def = getSkillDef("mogu.coding");
  assert.equal(def.source, "coding");
  assert.ok(def.ops.includes("run"));
  assert.ok(def.ops.includes("retry"));
});

test("buildCodexArgs includes workspace and prompt", () => {
  const args = buildCodexArgs({
    workspace: "D:\\proj",
    prompt: "add tests",
    model: "gpt-4o",
  });
  assert.ok(args.includes("exec"));
  assert.ok(args.includes("-C"));
  assert.ok(args.includes("D:\\proj"));
  assert.ok(args.includes("add tests"));
  assert.ok(args.includes("-m"));
});

test("buildTraeArgs includes working-dir and trajectory", () => {
  const args = buildTraeArgs({
    workspace: "/tmp/ws",
    prompt: "fix bug",
    provider: "openai",
    model: "gpt-4o",
    trajectoryFile: "/tmp/t.json",
  });
  assert.equal(args[0], "run");
  assert.ok(args.includes("--working-dir"));
  assert.ok(args.includes("/tmp/ws"));
  assert.ok(args.includes("--trajectory-file"));
});

test("probeAll reports vendor roots without throwing", () => {
  const probed = probeAll({ codingVendorRoot: "D:\\Project\\vendor" });
  assert.equal(probed.ok, true);
  assert.ok(probed.engines.codex);
  assert.ok(probed.engines.trae);
  const roots = resolveVendorRoots({ codingVendorRoot: "D:\\Project\\vendor" });
  assert.match(roots.codexRepo, /openai-codex$/);
  assert.match(roots.traeRepo, /trae-agent$/);
});

test("coding status op returns engines", async () => {
  const result = await coding.status({
    deps: { settings: { codingDefaultEngine: "codex", codingWorkspace: "" } },
  });
  assert.equal(result.ok, true);
  assert.ok(result.engines.codex);
});

test("coding preflight fails without workspace when prompt set", async () => {
  const result = await coding.preflight({
    deps: {
      settings: {
        codingDefaultEngine: "codex",
        codingWorkspace: "",
        codingCodexPath: process.execPath,
      },
    },
    args: { prompt: "x", engine: "codex" },
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === "workspace_missing"));
});

test("coding run creates coding-source task and can cancel missing job", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-coding-"));
  const taskStore = new TaskStore(path.join(dir, "tasks.json"));
  const cancelled = await coding.cancel({
    deps: { taskStore, settings: {} },
    args: { moguTaskId: "no-such-job" },
  });
  assert.equal(cancelled.ok, false);

  const trajPath = path.join(dir, "traj.json");
  await fs.writeJson(trajPath, {
    steps: [
      { tool: "bash", content: "echo hi" },
      { tool: "edit", content: "file.py" },
    ],
  });
  const traj = await summarizeTrajectory(trajPath);
  assert.equal(traj.ok, true);
  assert.match(traj.summary, /bash/);
});

test("otherEngine flips codex/trae", () => {
  assert.equal(coding.otherEngine("codex"), "trae");
  assert.equal(coding.otherEngine("trae"), "codex");
});

test("task store accepts coding source", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-coding-src-"));
  const store = new TaskStore(path.join(dir, "tasks.json"));
  const task = await store.create({
    source: "coding",
    kind: "skill.mogu.coding.run",
    name: "test",
    status: "running",
  });
  assert.equal(task.source, "coding");
});

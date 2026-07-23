const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  buildEngineAArgs,
  buildEngineBArgs,
  buildBrainEnv,
  probeAll,
  summarizeTrajectory,
  resolveRuntimeRoots,
  ENGINE_A,
  ENGINE_B,
} = require("../src/main/moguai/coding");
const coding = require("../src/main/skills/handlers/coding");
const { getSkillDef, SKILL_IDS } = require("../src/main/skills/registry");
const { TaskStore } = require("../src/main/task-store");

test("buildBrainEnv reuses one MOGU key for tool subprocesses", () => {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevAllow = process.env.MOGU_ALLOW_HOST_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.MOGU_ALLOW_HOST_API_KEY;
  try {
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
    // Empty MOGU settings must not inherit a host shell key by default
    assert.equal(buildBrainEnv({}, "").hasKey, false);
  } finally {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
    if (prevAllow === undefined) delete process.env.MOGU_ALLOW_HOST_API_KEY;
    else process.env.MOGU_ALLOW_HOST_API_KEY = prevAllow;
  }
});

test("mogu.coding is registered with coding source", () => {
  assert.ok(SKILL_IDS.includes("mogu.coding"));
  const def = getSkillDef("mogu.coding");
  assert.equal(def.source, "coding");
  assert.ok(def.ops.includes("run"));
  assert.ok(def.ops.includes("retry"));
});

test("buildEngineAArgs includes workspace and prompt", () => {
  const args = buildEngineAArgs({
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

test("buildEngineBArgs includes working-dir and trajectory", () => {
  const args = buildEngineBArgs({
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

test("probeAll reports moguai runtime roots without throwing", () => {
  const probed = probeAll({ moguaiRuntimeRoot: "D:\\Project\\vendor" });
  assert.equal(probed.ok, true);
  assert.ok(probed.engines[ENGINE_A]);
  assert.ok(probed.engines[ENGINE_B]);
  const roots = resolveRuntimeRoots({ moguaiRuntimeRoot: "D:\\Project\\vendor" });
  assert.match(roots.engineARepo, /moguai-runtime-a$/);
  assert.match(roots.engineBRepo, /moguai-runtime-b$/);
});

test("ensureRuntimeLayout creates per-user folders under userData", async () => {
  const { ensureRuntimeLayout, resolveRuntimeRoot } = require("../src/main/moguai/coding");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moguai-ud-"));
  const settings = { userDataPath: dir };
  assert.match(resolveRuntimeRoot(settings), /moguai-runtimes$/);
  const layout = ensureRuntimeLayout(settings);
  assert.equal(await fs.pathExists(layout.engineARepo), true);
  assert.equal(await fs.pathExists(layout.engineBRepo), true);
  assert.equal(await fs.pathExists(layout.readmePath), true);
  const probed = probeAll(settings);
  assert.equal(probed.layoutReady, true);
  assert.equal(probed.engines[ENGINE_A].installed, false);
  assert.match(probed.engines[ENGINE_A].message, /不受影响|尚未安装/);
});

test("coding status op returns engines", async () => {
  const result = await coding.status({
    deps: { settings: { codingDefaultEngine: ENGINE_A, codingWorkspace: "" } },
  });
  assert.equal(result.ok, true);
  assert.ok(result.engines[ENGINE_A]);
});

test("coding preflight fails without workspace when prompt set", async () => {
  const result = await coding.preflight({
    deps: {
      settings: {
        codingDefaultEngine: ENGINE_A,
        codingWorkspace: "",
        codingEngineAPath: process.execPath,
      },
    },
    args: { prompt: "x", engine: ENGINE_A },
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === "workspace_missing"));
});

test("coding run creates coding-source task and can cancel missing job", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moguai-coding-"));
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

test("otherEngine flips moguai_a/moguai_b", () => {
  assert.equal(coding.otherEngine(ENGINE_A), ENGINE_B);
  assert.equal(coding.otherEngine(ENGINE_B), ENGINE_A);
});

test("task store accepts coding source", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moguai-coding-src-"));
  const store = new TaskStore(path.join(dir, "tasks.json"));
  const task = await store.create({
    source: "coding",
    kind: "skill.mogu.coding.run",
    name: "test",
    status: "running",
  });
  assert.equal(task.source, "coding");
});

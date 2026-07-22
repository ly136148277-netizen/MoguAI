const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { spawnSync } = require("node:child_process");
const {
  createCodingToolRunner,
  grepWorkspace,
} = require("../src/main/skills/coding-agent-tools");
const { shouldUseCodingAgent, buildSystemPrompt } = require("../src/main/skills/coding-agent-loop");

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moguai-agent-"));
  spawnSync("git", ["init"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["config", "user.email", "t@t.t"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir, windowsHide: true });
  fs.outputFileSync(path.join(dir, "pkg", "mod.py"), "def add(a, b):\n    return a + b\n");
  fs.outputFileSync(path.join(dir, "tests", "test_mod.py"), "from pkg.mod import add\n");
  spawnSync("git", ["add", "-A"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir, windowsHide: true });
  return dir;
}

test("shouldUseCodingAgent defaults on for cloud, off for ollama", () => {
  const keys = ["MOGU_CODING_AGENT", "MOGU_CLOUD_PATCH", "MOGU_USE_OLLAMA", "OPENAI_API_KEY", "OPENAI_BASE_URL"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    assert.equal(
      shouldUseCodingAgent(
        { agentApiBaseUrl: "https://example.com/v1", agentApiKey: "sk-x" },
        {}
      ),
      true
    );
    assert.equal(shouldUseCodingAgent({ codingUseOllama: true }, {}), false);
    assert.equal(shouldUseCodingAgent({}, { codingAgent: false }), false);
    process.env.MOGU_CODING_AGENT = "1";
    assert.equal(shouldUseCodingAgent({ codingUseOllama: true }, {}), true);
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test("buildSystemPrompt requires plan then grep/patch", () => {
  const s = buildSystemPrompt();
  assert.match(s, /set_plan/i);
  assert.match(s, /grep/i);
  assert.match(s, /rollback/i);
});

test("tool runner: plan gate, grep, checkpoint/rollback, apply", async () => {
  const dir = initTempRepo();
  try {
    const runner = createCodingToolRunner({ workspace: dir });
    const escaped = await runner.execute("read", { path: "../outside.py" });
    assert.match(escaped, /ERROR/);

    const blocked = await runner.execute("apply_patch", {
      patch: [
        "pkg/mod.py",
        "<<<<<<< SEARCH",
        "def add(a, b):",
        "    return a + b",
        "=======",
        "def add(a, b):",
        "    return a - b",
        ">>>>>>> REPLACE",
      ].join("\n"),
    });
    assert.match(blocked, /set_plan first/i);

    const planned = await runner.execute("set_plan", {
      hypothesis: "add returns wrong value",
      target_files: ["pkg/mod.py"],
      approach: "change return expression",
    });
    assert.match(planned, /ok=true/);

    const grepped = await runner.execute("grep", { pattern: "def add", glob: "*.py" });
    assert.match(grepped, /mod\.py/);
    // production hit should appear; demote tests — first content hit preferably pkg
    assert.match(grepped, /pkg\/mod\.py|mod\.py/);

    const patch = [
      "pkg/mod.py",
      "<<<<<<< SEARCH",
      "def add(a, b):",
      "    return a + b",
      "=======",
      "def add(a, b):",
      "    return a + b + 0",
      ">>>>>>> REPLACE",
    ].join("\n");
    const applied = await runner.execute("apply_patch", { patch });
    assert.match(applied, /ok=true/);
    assert.match(applied, /checkpoint=cp/);
    assert.equal(runner.isDirty(), true);

    const rolled = await runner.execute("rollback", { to: "head" });
    assert.match(rolled, /ok=true/);
    assert.equal(runner.isDirty(), false);
    const body = fs.readFileSync(path.join(dir, "pkg", "mod.py"), "utf8").replace(/\r\n/g, "\n");
    assert.match(body, /return a \+ b\n/);

    // re-apply then rollback to last checkpoint (pre_apply state = clean)
    await runner.execute("apply_patch", { patch });
    assert.equal(runner.isDirty(), true);
    const cps = runner.getCheckpoints();
    assert.ok(cps.length >= 1);
    const back = await runner.execute("rollback", { to: "last" });
    assert.match(back, /ok=true/);

    assert.ok(runner.getUsed().includes("grep"));
    assert.ok(runner.getUsed().includes("set_plan"));
    assert.ok(runner.getUsed().includes("apply_patch"));
    assert.ok(runner.getUsed().includes("rollback"));
  } finally {
    fs.removeSync(dir);
  }
});

test("grepWorkspace finds content with node fallback", async () => {
  const dir = initTempRepo();
  try {
    const r = await grepWorkspace(dir, { pattern: "return a \\+ b", glob: "*.py" });
    assert.equal(r.ok, true);
    assert.ok((r.hits || []).some((h) => h.path.includes("mod.py")));
  } finally {
    fs.removeSync(dir);
  }
});

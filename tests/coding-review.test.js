const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { spawnSync } = require("node:child_process");
const {
  parsePorcelain,
  extractPathsFromText,
  collectGitReview,
  suggestCommitMessage,
  commitWorkspace,
  installFixHints,
  isGitRepo,
} = require("../src/main/skills/coding-review");
const { buildHistoryForBrain, loadMemoryPreamble } = require("../src/main/agent-brain");
const { getSkillDef } = require("../src/main/skills/registry");

describe("coding-review", () => {
  it("parses porcelain and extracts paths from logs", () => {
    const files = parsePorcelain(" M src/a.js\n?? new.md\n");
    assert.equal(files.length, 2);
    assert.equal(files[0].path, "src/a.js");
    const guessed = extractPathsFromText("modified: src/main/foo.js and wrote docs/a.md");
    assert.ok(guessed.some((p) => p.includes("foo.js")));
  });

  it("suggests commit message from prompt", () => {
    assert.match(suggestCommitMessage({ prompt: "add login button" }), /chore: add login button/);
  });

  it("collects review and can commit in temp git repo", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-git-"));
    spawnSync("git", ["init"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["config", "user.email", "test@mogu.local"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["config", "user.name", "Mogu Test"], { cwd: dir, windowsHide: true });
    await fs.writeFile(path.join(dir, "hello.txt"), "hi\n", "utf8");
    spawnSync("git", ["add", "hello.txt"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["commit", "-m", "init"], { cwd: dir, windowsHide: true });
    await fs.writeFile(path.join(dir, "hello.txt"), "hi2\n", "utf8");

    assert.equal(isGitRepo(dir), true);
    const review = collectGitReview(dir);
    assert.equal(review.ok, true);
    assert.equal(review.git, true);
    assert.ok(review.fileCount >= 1);
    assert.equal(review.canCommit, true);

    const committed = commitWorkspace(dir, "chore: bump hello");
    assert.equal(committed.ok, true);
    assert.ok(committed.commit);

    const clean = collectGitReview(dir);
    assert.equal(clean.canCommit, false);
  });

  it("installFixHints prefers one-click install CTA", () => {
    const fix = installFixHints({
      moguai_a: {
        installed: false,
        message: "missing",
        vendorRepo: null,
        fixCommands: ["moguai-coding-a --version"],
      },
      moguai_b: {
        installed: false,
        message: "missing",
        vendorRepo: "D:\\Project\\vendor\\moguai-runtime-b",
        fixCommands: ["部署：D:\\Project\\vendor\\moguai-runtime-b", "入口：moguai-coding-b"],
      },
    });
    assert.equal(fix.canInstallRuntime, true);
    assert.equal(fix.upgradeEngine, "all");
    assert.ok(fix.fixText.includes("一键"));
    assert.ok(fix.copyCommands.some((c) => c.includes("安装/升级")));
  });

  it("coding registry includes review/commit/verify/accept/discard", () => {
    const def = getSkillDef("mogu.coding");
    assert.ok(def.ops.includes("review"));
    assert.ok(def.ops.includes("commit"));
    assert.ok(def.ops.includes("verify"));
    assert.ok(def.ops.includes("accept"));
    assert.ok(def.ops.includes("discard"));
  });

  it("accept and discard round-trip in temp git repo", async () => {
    const {
      acceptWorkspaceChanges,
      discardWorkspaceChanges,
      collectGitReview,
    } = require("../src/main/skills/coding-review");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moguai-accept-"));
    try {
      spawnSync("git", ["init"], { cwd: dir, encoding: "utf8", windowsHide: true });
      spawnSync("git", ["config", "user.email", "t@t.t"], { cwd: dir, windowsHide: true });
      spawnSync("git", ["config", "user.name", "t"], { cwd: dir, windowsHide: true });
      await fs.writeFile(path.join(dir, "a.js"), "console.log(1)\n", "utf8");
      spawnSync("git", ["add", "."], { cwd: dir, windowsHide: true });
      spawnSync("git", ["commit", "-m", "init"], { cwd: dir, windowsHide: true });
      await fs.writeFile(path.join(dir, "a.js"), "console.log(2)\n", "utf8");
      await fs.writeFile(path.join(dir, "b.js"), "console.log('new')\n", "utf8");
      const before = collectGitReview(dir);
      assert.ok(before.fileCount >= 2);
      const accepted = acceptWorkspaceChanges(dir, { paths: ["a.js"] });
      assert.equal(accepted.ok, true);
      const discarded = discardWorkspaceChanges(dir, { paths: ["b.js"] });
      assert.equal(discarded.ok, true);
      assert.ok(!fs.pathExistsSync(path.join(dir, "b.js")));
      const afterDiscardA = discardWorkspaceChanges(dir, { paths: ["a.js"] });
      assert.equal(afterDiscardA.ok, true);
      const clean = collectGitReview(dir);
      assert.equal(clean.fileCount, 0);
    } finally {
      await fs.remove(dir);
    }
  });
});

describe("brain history + memory helpers", () => {
  it("compresses long history", () => {
    const history = [];
    for (let i = 0; i < 12; i += 1) {
      history.push({ role: "user", content: `u${i} `.repeat(20) });
      history.push({ role: "assistant", content: `a${i}` });
    }
    const { messages, compressed } = buildHistoryForBrain(history, { keepRecent: 4 });
    assert.equal(compressed, true);
    assert.ok(messages[0].content.includes("更早对话摘要"));
    assert.ok(messages.length < history.length);
  });

  it("loadMemoryPreamble returns facts via skillRuntime", async () => {
    const runtime = {
      invoke: async () => ({
        ok: true,
        facts: [{ key: "project", value: "PAI" }],
      }),
    };
    const mem = await loadMemoryPreamble(runtime, "项目在哪");
    assert.match(mem.text, /跨会话记忆/);
    assert.equal(mem.facts.length, 1);
  });
});

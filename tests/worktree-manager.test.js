const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  WorktreeManager,
  validBaseline,
} = require("../src/main/moguai/worktree/worktree-manager");

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function createRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-worktree-repo-"));
  git(root, ["init"]);
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
  git(root, ["add", "README.md"]);
  git(root, ["-c", "user.name=MOGU Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline"]);
  return root;
}

test("managed worktrees are baseline-bound, read-only, and limited to two", async () => {
  const repo = createRepo();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-worktrees-"));
  const decisions = [];
  try {
    const baseline = git(repo, ["rev-parse", "HEAD"]);
    const manager = new WorktreeManager({
      repoRoot: repo,
      tempRoot,
      baselineCommit: baseline,
      authorize: async (payload) => {
        decisions.push(payload);
        return { allowed: true };
      },
    });
    const first = await manager.add();
    const second = await manager.add();
    assert.equal(first.baselineCommit, baseline);
    assert.equal(first.readOnly, true);
    assert.equal(first.capabilities.write, false);
    assert.equal(git(first.path, ["rev-parse", "HEAD"]), baseline);
    assert.equal((await manager.list()).length, 2);
    await assert.rejects(manager.add(), (error) => error.code === "worktree_limit");
    assert.throws(() => manager.assertCapability("write"), (error) => error.code === "read_only");
    assert.throws(() => manager.assertCapability("commit"), (error) => error.code === "read_only");
    assert.throws(() => manager.assertCapability("push"), (error) => error.code === "read_only");
    assert.equal(manager.assertCapability("search"), true);
    assert.ok(decisions.every((decision) => decision.baselineCommit === baseline));
    await manager.remove(first.id);
    await manager.remove(second.id);
    assert.deepEqual(await manager.list(), []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("prune and remove never affect user-owned worktrees", async () => {
  const repo = createRepo();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-worktrees-owned-"));
  const userWorktree = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-user-worktree-parent-"));
  fs.rmSync(userWorktree, { recursive: true, force: true });
  try {
    git(repo, ["worktree", "add", "--detach", userWorktree, "HEAD"]);
    const manager = new WorktreeManager({
      repoRoot: repo,
      tempRoot,
      baselineCommit: "HEAD",
      authorize: async () => ({ allowed: true }),
    });
    const owned = await manager.add();
    await assert.rejects(manager.remove("not-owned"), (error) => error.code === "not_owned");
    const pruned = await manager.prune();
    assert.equal(pruned.managerOwnedOnly, true);
    assert.equal(fs.existsSync(userWorktree), true);
    assert.equal(git(userWorktree, ["rev-parse", "--is-inside-work-tree"]), "true");
    await manager.remove(owned.id);
    assert.equal(fs.existsSync(userWorktree), true);
    git(repo, ["worktree", "remove", "--force", userWorktree]);
  } finally {
    if (fs.existsSync(userWorktree)) {
      spawnSync("git", ["worktree", "remove", "--force", userWorktree], {
        cwd: repo,
        windowsHide: true,
      });
    }
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(userWorktree, { recursive: true, force: true });
  }
});

test("worktree mutations require authorization and refs reject injection", async () => {
  const repo = createRepo();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-worktrees-deny-"));
  try {
    assert.throws(() => validBaseline("--help;touch-owned"), (error) => error.code === "invalid_baseline");
    const manager = new WorktreeManager({
      repoRoot: repo,
      tempRoot,
      baselineCommit: "HEAD",
      authorize: async () => ({ allowed: false, reason: "test_deny" }),
    });
    await assert.rejects(manager.add(), (error) => error.code === "authorization_denied");
    assert.deepEqual(await manager.list(), []);
    assert.equal(
      fs.readdirSync(tempRoot).filter((name) => name.startsWith("explore-")).length,
      0
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("recovery removes stale manager manifest entries without touching other paths", async () => {
  const repo = createRepo();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-worktrees-recovery-"));
  try {
    const first = new WorktreeManager({
      repoRoot: repo,
      tempRoot,
      baselineCommit: "HEAD",
      authorize: async () => true,
    });
    await first.list();
    const manifestPath = path.join(tempRoot, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.entries.push({
      id: "stale",
      path: path.join(tempRoot, "missing-stale"),
      baselineCommit: manifest.baselineCommit,
      status: "active",
      createdAt: new Date().toISOString(),
      readOnly: true,
    });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const recovered = new WorktreeManager({
      repoRoot: repo,
      tempRoot,
      baselineCommit: manifest.baselineCommit,
      authorize: async () => true,
    });
    assert.deepEqual(await recovered.list(), []);
    const saved = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.deepEqual(saved.entries, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

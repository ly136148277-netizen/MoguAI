const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { canonicalExisting, pathInside } = require("../terminal/session-manager");

const execFileAsync = promisify(execFile);
const MANIFEST_VERSION = 1;
const READ_ONLY_CAPABILITIES = Object.freeze({
  read: true,
  search: true,
  test: true,
  write: false,
  commit: false,
  push: false,
});

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validBaseline(value) {
  const baseline = String(value || "HEAD").trim();
  if (
    !baseline ||
    baseline.startsWith("-") ||
    baseline.includes("..") ||
    !/^[A-Za-z0-9_./-]+$/.test(baseline)
  ) {
    throw codedError("invalid_baseline", "Invalid baseline ref");
  }
  return baseline;
}

function publicEntry(entry) {
  return {
    id: entry.id,
    path: entry.path,
    baselineCommit: entry.baselineCommit,
    status: entry.status,
    createdAt: entry.createdAt,
    readOnly: true,
    capabilities: { ...READ_ONLY_CAPABILITIES },
  };
}

class WorktreeManager {
  constructor(options = {}) {
    if (typeof options.authorize !== "function") {
      throw codedError("authorization_required", "Worktree manager requires an authorization callback");
    }
    this.repoRoot = canonicalExisting(options.repoRoot);
    this.tempRootInput = path.resolve(String(options.tempRoot || "").trim());
    if (!this.tempRootInput) throw codedError("temp_root_required", "A managed temp root is required");
    this.baselineRef = validBaseline(options.baselineCommit || "HEAD");
    this.authorize = options.authorize;
    this.audit = typeof options.audit === "function" ? options.audit : () => {};
    this.execFile = options.execFile || execFileAsync;
    this.maxActive = Math.max(1, Math.min(2, Number(options.maxActive) || 2));
    this.manifestPath = path.join(this.tempRootInput, "manifest.json");
    this.manifest = null;
    this.ready = this._initialize();
  }

  _audit(event, payload = {}) {
    Promise.resolve(this.audit({ event, at: new Date().toISOString(), ...payload })).catch(() => {});
  }

  async _git(args, options = {}) {
    try {
      const result = await this.execFile("git", args, {
        cwd: options.cwd || this.repoRoot,
        encoding: "utf8",
        windowsHide: true,
        timeout: options.timeout || 60_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return {
        ok: true,
        stdout: String(result?.stdout || ""),
        stderr: String(result?.stderr || ""),
      };
    } catch (error) {
      return {
        ok: false,
        stdout: String(error?.stdout || ""),
        stderr: String(error?.stderr || ""),
        error: error?.message || String(error),
      };
    }
  }

  async _initialize() {
    await fsp.mkdir(this.tempRootInput, { recursive: true });
    this.tempRoot = canonicalExisting(this.tempRootInput);
    this.manifestPath = path.join(this.tempRoot, "manifest.json");
    const repoCheck = await this._git(["rev-parse", "--show-toplevel"]);
    if (!repoCheck.ok) throw codedError("not_git_repo", "Configured repository is not a Git worktree");
    const gitRoot = canonicalExisting(repoCheck.stdout.trim());
    if (gitRoot.toLowerCase() !== this.repoRoot.toLowerCase()) {
      throw codedError("repo_root_mismatch", "repoRoot must be the Git worktree root");
    }
    const resolved = await this._git([
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${this.baselineRef}^{commit}`,
    ]);
    if (!resolved.ok || !/^[0-9a-f]{40,64}$/i.test(resolved.stdout.trim())) {
      throw codedError("invalid_baseline", `Unable to resolve baseline: ${this.baselineRef}`);
    }
    this.baselineCommit = resolved.stdout.trim();
    this.manifest = await this._loadManifest();
    if (
      this.manifest.repoRoot.toLowerCase() !== this.repoRoot.toLowerCase() ||
      this.manifest.baselineCommit !== this.baselineCommit
    ) {
      if (this.manifest.entries.length) {
        throw codedError("manifest_binding_mismatch", "Managed worktree manifest belongs to another repository or baseline");
      }
      this.manifest.repoRoot = this.repoRoot;
      this.manifest.baselineCommit = this.baselineCommit;
    }
    await this._recover();
    await this._saveManifest();
    return this;
  }

  async _loadManifest() {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.manifestPath, "utf8"));
      if (parsed.version !== MANIFEST_VERSION || !Array.isArray(parsed.entries)) {
        throw new Error("unsupported manifest");
      }
      return parsed;
    } catch (error) {
      if (error.code !== "ENOENT" && !/unsupported manifest/.test(error.message)) {
        throw codedError("manifest_invalid", `Cannot read managed worktree manifest: ${error.message}`);
      }
      return {
        version: MANIFEST_VERSION,
        repoRoot: this.repoRoot,
        baselineCommit: this.baselineCommit,
        entries: [],
        updatedAt: new Date().toISOString(),
      };
    }
  }

  async _saveManifest() {
    this.manifest.updatedAt = new Date().toISOString();
    const temp = `${this.manifestPath}.${process.pid}.tmp`;
    await fsp.writeFile(temp, `${JSON.stringify(this.manifest, null, 2)}\n`, "utf8");
    await fsp.rename(temp, this.manifestPath);
  }

  _ownedPath(candidate) {
    const resolved = path.resolve(String(candidate || ""));
    if (!pathInside(this.tempRoot, resolved) || resolved === this.tempRoot) {
      throw codedError("path_escape", "Managed worktree path escapes the configured temp root");
    }
    return resolved;
  }

  async _recover() {
    let changed = false;
    const kept = [];
    for (const entry of this.manifest.entries) {
      let ownedPath;
      try {
        ownedPath = this._ownedPath(entry.path);
      } catch {
        changed = true;
        continue;
      }
      if (!fs.existsSync(ownedPath)) {
        changed = true;
        continue;
      }
      let canonical;
      try {
        canonical = canonicalExisting(ownedPath);
      } catch {
        changed = true;
        continue;
      }
      if (!pathInside(this.tempRoot, canonical)) {
        // Never follow/recover a junction that now points outside manager storage.
        changed = true;
        continue;
      }
      if (entry.status === "pending" || entry.status === "removing") {
        await this._git(["worktree", "remove", "--force", canonical]);
        changed = true;
        continue;
      }
      kept.push({ ...entry, path: canonical, status: "active", readOnly: true });
    }
    this.manifest.entries = kept;
    if (changed) await this._saveManifest();
  }

  async _authorize(action, payload = {}) {
    const decision = await this.authorize({
      tool: "mogu.worktree",
      action,
      riskLevel: 2,
      repoRoot: this.repoRoot,
      baselineCommit: this.baselineCommit,
      ...payload,
    });
    if (!(decision === true || decision?.allowed === true)) {
      this._audit("worktree.denied", { action, reason: decision?.reason || "authorization_denied" });
      throw codedError("authorization_denied", decision?.message || "Worktree operation was not authorized");
    }
  }

  async list() {
    await this.ready;
    return this.manifest.entries
      .filter((entry) => entry.status === "active")
      .map(publicEntry);
  }

  async add(options = {}) {
    await this.ready;
    const active = this.manifest.entries.filter((entry) => entry.status === "active");
    if (active.length >= this.maxActive) {
      throw codedError("worktree_limit", `Maximum active exploration worktrees reached (${this.maxActive})`);
    }
    await this._authorize("add", {
      permission: options.permission || {},
      readOnly: true,
    });
    const id = `explore-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    const target = this._ownedPath(path.join(this.tempRoot, id));
    if (fs.existsSync(target)) throw codedError("path_exists", "Managed worktree target already exists");
    const entry = {
      id,
      path: target,
      baselineCommit: this.baselineCommit,
      status: "pending",
      createdAt: new Date().toISOString(),
      readOnly: true,
    };
    this.manifest.entries.push(entry);
    await this._saveManifest();
    const added = await this._git(["worktree", "add", "--detach", target, this.baselineCommit], {
      timeout: 120_000,
    });
    if (!added.ok) {
      this.manifest.entries = this.manifest.entries.filter((item) => item.id !== id);
      await this._saveManifest();
      throw codedError("worktree_add_failed", added.stderr || added.error || "git worktree add failed");
    }
    const canonical = canonicalExisting(target);
    if (!pathInside(this.tempRoot, canonical)) {
      throw codedError("path_escape", "Created worktree escaped the configured temp root");
    }
    entry.path = canonical;
    entry.status = "active";
    await this._saveManifest();
    this._audit("worktree.added", publicEntry(entry));
    return publicEntry(entry);
  }

  async remove(id, options = {}) {
    await this.ready;
    const entry = this.manifest.entries.find((item) => item.id === String(id || ""));
    if (!entry) throw codedError("not_owned", "Worktree is not manager-owned");
    const target = this._ownedPath(entry.path);
    if (fs.existsSync(target)) {
      const canonical = canonicalExisting(target);
      if (!pathInside(this.tempRoot, canonical)) {
        throw codedError("path_escape", "Refusing to remove a worktree that resolves outside the managed root");
      }
    }
    await this._authorize("remove", {
      worktreeId: entry.id,
      path: target,
      permission: options.permission || {},
    });
    entry.status = "removing";
    await this._saveManifest();
    const removed = await this._git(["worktree", "remove", "--force", target], { timeout: 120_000 });
    if (!removed.ok && fs.existsSync(target)) {
      entry.status = "active";
      await this._saveManifest();
      throw codedError("worktree_remove_failed", removed.stderr || removed.error || "git worktree remove failed");
    }
    this.manifest.entries = this.manifest.entries.filter((item) => item.id !== entry.id);
    await this._saveManifest();
    this._audit("worktree.removed", { id: entry.id, path: target });
    return { ok: true, id: entry.id, path: target };
  }

  async prune(options = {}) {
    await this.ready;
    await this._authorize("prune", { permission: options.permission || {} });
    const before = this.manifest.entries.length;
    await this._recover();
    // Deliberately do not run `git worktree prune`: it could alter user-owned worktrees.
    const removed = before - this.manifest.entries.length;
    this._audit("worktree.pruned", { removed });
    return { ok: true, removed, managerOwnedOnly: true };
  }

  assertCapability(capability) {
    const name = String(capability || "").toLowerCase();
    if (!READ_ONLY_CAPABILITIES[name]) {
      throw codedError("read_only", `Capability is forbidden in read-only worktrees: ${name}`);
    }
    return true;
  }
}

module.exports = {
  WorktreeManager,
  READ_ONLY_CAPABILITIES,
  MANIFEST_VERSION,
  validBaseline,
};

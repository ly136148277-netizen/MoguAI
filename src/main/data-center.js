const fs = require("fs-extra");
const path = require("path");
const os = require("os");

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  "models",
  "checkpoints",
  "loras",
  "vae",
  "controlnet",
  "embeddings",
  "gguf",
]);

const SECRET_NAME = /(token|secret|password|passwd|api[-_]?key|\.env$|credentials)/i;

/**
 * Bounded folder size scan (skips model-heavy / secret-looking names).
 */
async function measurePath(rootPath, options = {}) {
  const maxDepth = Math.max(1, Number(options.maxDepth) || 4);
  const maxFiles = Math.max(100, Number(options.maxFiles) || 8_000);
  const root = path.resolve(String(rootPath || ""));
  const result = {
    path: root,
    exists: false,
    bytes: 0,
    files: 0,
    truncated: false,
    error: null,
    recentFiles: [],
  };
  if (!root) {
    result.error = "empty_path";
    return result;
  }
  if (!(await fs.pathExists(root))) {
    return result;
  }
  result.exists = true;

  const recent = [];
  let files = 0;
  let bytes = 0;
  let truncated = false;

  async function walk(dir, depth) {
    if (truncated || files >= maxFiles) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      result.error = error.message;
      return;
    }
    for (const entry of entries) {
      if (truncated || files >= maxFiles) {
        truncated = true;
        return;
      }
      const name = entry.name;
      if (SECRET_NAME.test(name)) continue;
      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(name.toLowerCase()) || SKIP_DIR_NAMES.has(name)) continue;
        if (depth >= maxDepth) continue;
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const st = await fs.stat(full);
        files += 1;
        bytes += st.size;
        recent.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // skip unreadable
      }
    }
  }

  await walk(root, 0);
  recent.sort((a, b) => b.mtimeMs - a.mtimeMs);
  result.bytes = bytes;
  result.files = files;
  result.truncated = truncated;
  result.recentFiles = recent.slice(0, 8).map((item) => ({
    path: item.path,
    size: item.size,
    mtime: new Date(item.mtimeMs).toISOString(),
  }));
  return result;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function scanDataCenter({ userData, settings = {}, storageDir = null, logger = null } = {}) {
  const paiRoot = settings.paiRoot || null;
  const comfyRoot = settings.comfyUiRoot || settings.comfyRoot || null;
  const ollamaModels =
    process.env.OLLAMA_MODELS ||
    (process.platform === "win32"
      ? path.join(os.homedir(), ".ollama", "models")
      : path.join(os.homedir(), ".ollama", "models"));

  const targets = [
    { id: "appData", label: "MOGU AppData", path: userData },
    { id: "storage", label: "模型存储", path: storageDir },
    { id: "pai", label: "PAI", path: paiRoot },
    { id: "comfy", label: "ComfyUI", path: comfyRoot },
    { id: "ollama", label: "Ollama models", path: ollamaModels },
    { id: "logs", label: "日志", path: userData ? path.join(userData, "logs") : null },
  ].filter((item) => item.path);

  const roots = [];
  for (const target of targets) {
    try {
      const measured = await measurePath(target.path, { maxDepth: 3, maxFiles: 4000 });
      roots.push({
        ...target,
        ...measured,
        bytesLabel: formatBytes(measured.bytes),
      });
    } catch (error) {
      logger?.warn?.("data-center scan failed", { id: target.id, message: error.message });
      roots.push({
        ...target,
        exists: false,
        bytes: 0,
        files: 0,
        bytesLabel: "0 B",
        error: error.message,
        recentFiles: [],
      });
    }
  }

  let tasksSummary = { total: 0, byStatus: {}, bySource: {} };
  const tasksFile = userData ? path.join(userData, "tasks.json") : null;
  if (tasksFile && (await fs.pathExists(tasksFile))) {
    try {
      const data = await fs.readJson(tasksFile);
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      tasksSummary.total = tasks.length;
      for (const task of tasks) {
        const status = task.status || "unknown";
        const source = task.source || "unknown";
        tasksSummary.byStatus[status] = (tasksSummary.byStatus[status] || 0) + 1;
        tasksSummary.bySource[source] = (tasksSummary.bySource[source] || 0) + 1;
      }
    } catch {
      // ignore
    }
  }

  return {
    ok: true,
    scannedAt: new Date().toISOString(),
    roots,
    tasksSummary,
    notes: [
      "默认跳过 models/checkpoints 等大目录与疑似密钥文件名。",
      "导出诊断包不含 token、API key 与模型权重。",
    ],
  };
}

async function exportDiagnosticPack({
  userData,
  settingsPublic = {},
  storageDir = null,
  destDir = null,
} = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outRoot = destDir || path.join(os.tmpdir(), `mogu-diagnostic-${stamp}`);
  await fs.ensureDir(outRoot);

  const manifest = {
    createdAt: new Date().toISOString(),
    app: "MOGU AI",
    excludes: ["secrets", "tokens", "api keys", "model weights"],
    files: [],
  };

  async function copyIfExists(rel, from, toName = rel) {
    if (!from || !(await fs.pathExists(from))) return;
    const base = path.basename(from);
    if (SECRET_NAME.test(base)) return;
    const dest = path.join(outRoot, toName);
    await fs.ensureDir(path.dirname(dest));
    const st = await fs.stat(from);
    if (st.isDirectory()) {
      await fs.copy(from, dest, {
        filter: (src) => !SECRET_NAME.test(path.basename(src)),
      });
    } else {
      await fs.copy(from, dest);
    }
    manifest.files.push(toName);
  }

  await fs.writeJson(path.join(outRoot, "settings.public.json"), settingsPublic, { spaces: 2 });
  manifest.files.push("settings.public.json");

  if (userData) {
    await copyIfExists("tasks.json", path.join(userData, "tasks.json"));
    await copyIfExists("logs", path.join(userData, "logs"), "logs");
    const sessionsDir = path.join(userData, "chat-sessions");
    if (await fs.pathExists(sessionsDir)) {
      const index = [];
      const names = await fs.readdir(sessionsDir);
      for (const name of names.slice(0, 200)) {
        if (!name.endsWith(".json")) continue;
        try {
          const raw = await fs.readJson(path.join(sessionsDir, name));
          index.push({
            id: raw.id || name,
            title: raw.title || null,
            updatedAt: raw.updatedAt || null,
            messageCount: Array.isArray(raw.messages) ? raw.messages.length : null,
          });
        } catch {
          // skip
        }
      }
      await fs.writeJson(path.join(outRoot, "chat-sessions-index.json"), index, { spaces: 2 });
      manifest.files.push("chat-sessions-index.json");
    }
  }

  const scan = await scanDataCenter({ userData, settings: settingsPublic, storageDir });
  await fs.writeJson(path.join(outRoot, "data-scan.json"), scan, { spaces: 2 });
  manifest.files.push("data-scan.json");
  await fs.writeJson(path.join(outRoot, "manifest.json"), manifest, { spaces: 2 });

  return { ok: true, path: outRoot, manifest };
}

async function planCleanup({ userData } = {}) {
  const actions = [];
  if (!userData) return { ok: true, dryRun: true, actions, totalBytes: 0 };

  const candidates = [
    path.join(userData, "logs"),
    path.join(userData, "downloads"),
    path.join(userData, "tmp"),
  ];
  for (const dir of candidates) {
    if (!(await fs.pathExists(dir))) continue;
    const measured = await measurePath(dir, { maxDepth: 5, maxFiles: 20_000 });
    if (measured.bytes > 0) {
      actions.push({
        path: dir,
        kind: "clear_dir_contents",
        bytes: measured.bytes,
        bytesLabel: formatBytes(measured.bytes),
        reason: "缓存/日志可清理候选",
      });
    }
  }
  const totalBytes = actions.reduce((sum, item) => sum + (item.bytes || 0), 0);
  return {
    ok: true,
    dryRun: true,
    actions,
    totalBytes,
    totalBytesLabel: formatBytes(totalBytes),
    message: "仅 dry-run。真正删除必须二次确认。",
  };
}

async function executeCleanup({ actions = [], confirmToken = "" } = {}) {
  if (confirmToken !== "CONFIRM_DELETE") {
    return {
      ok: false,
      reason: "needs_confirmation",
      message: "真正删除需要 confirmToken=CONFIRM_DELETE。",
    };
  }
  const deleted = [];
  for (const action of actions) {
    if (action.kind !== "clear_dir_contents" || !action.path) continue;
    if (!(await fs.pathExists(action.path))) continue;
    const entries = await fs.readdir(action.path);
    for (const name of entries) {
      if (SECRET_NAME.test(name)) continue;
      await fs.remove(path.join(action.path, name));
    }
    deleted.push(action.path);
  }
  return { ok: true, deleted, message: `已清理 ${deleted.length} 个目录内容。` };
}

/**
 * Full app backup (no secrets/tokens). Restorable via importBackupPack.
 */
async function exportBackupPack({
  userData,
  settingsPublic = {},
  destDir = null,
} = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outRoot = destDir || path.join(os.tmpdir(), `mogu-backup-${stamp}`);
  await fs.ensureDir(outRoot);
  const manifest = {
    kind: "mogu-backup",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    excludes: ["secrets.json", "tokens", "api keys", "model weights"],
    files: [],
  };

  async function copySafe(from, toName) {
    if (!from || !(await fs.pathExists(from))) return;
    if (SECRET_NAME.test(path.basename(from))) return;
    const dest = path.join(outRoot, toName);
    await fs.ensureDir(path.dirname(dest));
    await fs.copy(from, dest, {
      filter: (src) => !SECRET_NAME.test(path.basename(src)),
    });
    manifest.files.push(toName);
  }

  const publicSettings = { ...settingsPublic };
  delete publicSettings.agentApiKey;
  delete publicSettings.openclawGatewayToken;
  await fs.writeJson(path.join(outRoot, "settings.public.json"), publicSettings, { spaces: 2 });
  manifest.files.push("settings.public.json");

  if (userData) {
    await copySafe(path.join(userData, "tasks.json"), "tasks.json");
    await copySafe(path.join(userData, "permission-grants.json"), "permission-grants.json");
    await copySafe(path.join(userData, "studio-pipeline.json"), "studio-pipeline.json");
    await copySafe(path.join(userData, "chat-sessions"), "chat-sessions");
    // Never copy secrets.json
  }

  await fs.writeJson(path.join(outRoot, "manifest.json"), manifest, { spaces: 2 });
  return { ok: true, path: outRoot, manifest };
}

async function importBackupPack({ backupDir, userData } = {}) {
  if (!backupDir || !(await fs.pathExists(backupDir))) {
    return { ok: false, error: "backup_missing", message: "备份目录不存在" };
  }
  if (!userData) {
    return { ok: false, error: "userdata_missing", message: "缺少 userData" };
  }
  const manifestPath = path.join(backupDir, "manifest.json");
  if (!(await fs.pathExists(manifestPath))) {
    return { ok: false, error: "manifest_missing", message: "不是有效的 MOGU 备份（缺 manifest）" };
  }
  const manifest = await fs.readJson(manifestPath);
  if (manifest.kind !== "mogu-backup") {
    return { ok: false, error: "kind_mismatch", message: "manifest.kind 不是 mogu-backup" };
  }

  const restored = [];
  const map = [
    ["tasks.json", "tasks.json"],
    ["permission-grants.json", "permission-grants.json"],
    ["studio-pipeline.json", "studio-pipeline.json"],
    ["chat-sessions", "chat-sessions"],
  ];
  for (const [fromName, toName] of map) {
    const from = path.join(backupDir, fromName);
    if (!(await fs.pathExists(from))) continue;
    if (SECRET_NAME.test(fromName)) continue;
    const dest = path.join(userData, toName);
    await fs.ensureDir(path.dirname(dest));
    await fs.copy(from, dest, { overwrite: true });
    restored.push(toName);
  }

  // Merge non-secret settings fields if present
  const pubPath = path.join(backupDir, "settings.public.json");
  let settingsMerged = false;
  if (await fs.pathExists(pubPath)) {
    const pub = await fs.readJson(pubPath);
    delete pub.agentApiKey;
    delete pub.openclawGatewayToken;
    const settingsPath = path.join(userData, "settings.json");
    const current = (await fs.pathExists(settingsPath)) ? await fs.readJson(settingsPath) : {};
    const next = { ...current, ...pub, agentApiKey: "", openclawGatewayToken: undefined };
    delete next.openclawGatewayToken;
    await fs.writeJson(settingsPath, next, { spaces: 2 });
    settingsMerged = true;
    restored.push("settings.json(merged-public)");
  }

  return {
    ok: true,
    restored,
    settingsMerged,
    message: `已恢复 ${restored.length} 项（未导入 secrets/token）`,
  };
}

module.exports = {
  measurePath,
  formatBytes,
  scanDataCenter,
  exportDiagnosticPack,
  exportBackupPack,
  importBackupPack,
  planCleanup,
  executeCleanup,
  SKIP_DIR_NAMES,
};

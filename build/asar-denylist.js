const path = require("path");
const fs = require("fs");

/**
 * Fail the pack if app.asar (or unpacked resources) contain secrets / non-runtime junk.
 * Explicit denylist — does not rely on .gitignore.
 */
const DENY_PATTERNS = [
  /(^|\/)config\/github\.token$/i,
  /(^|\/)[^/]+\.token$/i,
  /(^|\/)\.env$/i,
  /(^|\/)\.env\.[^/]+$/i,
  /(^|\/)secrets\.json$/i,
  /(^|\/)config\/mogu_[^/]+\.json$/i,
  /(^|\/)config\/xuzhou_[^/]+\.json$/i,
  /(^|\/)config\/signing\.example\.env$/i,
  /(^|\/)scripts\//i,
  /(^|\/)node_modules\/\.cache\//i,
];

function normalizeEntry(entry) {
  return String(entry || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

function findDenylistHits(entries) {
  const hits = [];
  for (const raw of entries) {
    const entry = normalizeEntry(raw);
    if (!entry) continue;
    for (const pattern of DENY_PATTERNS) {
      if (pattern.test(entry)) {
        hits.push(entry);
        break;
      }
    }
  }
  return [...new Set(hits)].sort();
}

function listAsarEntries(asarPath) {
  // Prefer electron-builder's bundled @electron/asar
  const candidates = [
    path.join(__dirname, "..", "node_modules", "@electron", "asar"),
    path.join(__dirname, "..", "node_modules", "asar"),
    "@electron/asar",
  ];
  let asar = null;
  for (const candidate of candidates) {
    try {
      asar = require(candidate);
      break;
    } catch {
      // try next
    }
  }
  if (!asar?.listPackage) {
    throw new Error("无法加载 @electron/asar 以检查 app.asar 清单");
  }
  return asar.listPackage(asarPath).map(normalizeEntry);
}

function assertAsarClean(asarPath) {
  if (!fs.existsSync(asarPath)) {
    throw new Error(`缺少 app.asar：${asarPath}`);
  }
  const entries = listAsarEntries(asarPath);
  const hits = findDenylistHits(entries);
  if (hits.length) {
    const preview = hits.slice(0, 20).join("\n  - ");
    throw new Error(
      `ASAR denylist 命中 ${hits.length} 个禁止路径（构建失败）:\n  - ${preview}`
    );
  }
  return { ok: true, entryCount: entries.length, hits: [] };
}

function assertResourcesClean(appOutDir) {
  const resourcesDir = path.join(appOutDir, "resources");
  const asarPath = path.join(resourcesDir, "app.asar");
  const result = assertAsarClean(asarPath);

  // Also scan common unpacked locations for leaked files by name.
  const leakedNames = ["github.token", "secrets.json", ".env"];
  const stack = [resourcesDir];
  while (stack.length) {
    const dir = stack.pop();
    let items = [];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (leakedNames.includes(item.name) || /\.token$/i.test(item.name)) {
        throw new Error(`resources 目录发现禁止文件：${full}`);
      }
    }
  }
  return result;
}

module.exports = {
  DENY_PATTERNS,
  findDenylistHits,
  assertAsarClean,
  assertResourcesClean,
};

const path = require("path");
const fs = require("fs-extra");

const MEDIA_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".gif",
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".avi",
]);

const DEFAULT_MAX_BYTES = 120 * 1024 * 1024;

function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir);
  const child = path.resolve(candidatePath);
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function buildMediaAllowRoots({
  paiRoot,
  comfyUiPath,
  modelStoragePath,
  userDataPath,
  extraRoots = [],
} = {}) {
  const roots = [];
  const push = (dir) => {
    if (!dir || typeof dir !== "string") return;
    const abs = path.resolve(dir);
    if (!roots.includes(abs)) roots.push(abs);
  };

  if (paiRoot) {
    push(paiRoot);
    push(path.join(paiRoot, "output"));
    push(path.join(paiRoot, "data"));
  }
  if (comfyUiPath) {
    push(comfyUiPath);
    push(path.join(comfyUiPath, "output"));
    push(path.join(comfyUiPath, "input"));
    push(path.join(comfyUiPath, "temp"));
  }
  push(modelStoragePath);
  push(userDataPath);
  for (const root of extraRoots) {
    push(root);
  }
  return roots;
}

/**
 * Validate a local media path for mogu-media / studio preview.
 * @returns {{ ok: true, abs: string, ext: string, sizeBytes: number } | { ok: false, error: string }}
 */
async function assertAllowedMediaPath(filePath, options = {}) {
  const abs = path.resolve(String(filePath || ""));
  if (!abs || abs === path.parse(abs).root) {
    return { ok: false, error: "无效的媒体路径" };
  }

  const ext = path.extname(abs).toLowerCase();
  if (!MEDIA_EXTENSIONS.has(ext)) {
    return { ok: false, error: `不允许的媒体类型：${ext || "(无扩展名)"}` };
  }

  const roots = Array.isArray(options.allowRoots) ? options.allowRoots : [];
  if (!roots.length) {
    return { ok: false, error: "未配置媒体白名单根目录" };
  }
  if (!roots.some((root) => isPathInside(root, abs))) {
    return { ok: false, error: "媒体路径不在允许的目录内" };
  }

  if (!(await fs.pathExists(abs))) {
    return { ok: false, error: `文件不存在：${abs}` };
  }

  let st;
  try {
    st = await fs.stat(abs);
  } catch (error) {
    return { ok: false, error: `无法读取文件：${error.message}` };
  }
  if (!st.isFile()) {
    return { ok: false, error: "媒体路径必须是文件" };
  }

  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : DEFAULT_MAX_BYTES;
  if (st.size > maxBytes) {
    return {
      ok: false,
      error: `文件过大（${Math.ceil(st.size / (1024 * 1024))}MB），上限 ${Math.ceil(maxBytes / (1024 * 1024))}MB`,
    };
  }

  return { ok: true, abs, ext, sizeBytes: st.size };
}

module.exports = {
  MEDIA_EXTENSIONS,
  DEFAULT_MAX_BYTES,
  isPathInside,
  buildMediaAllowRoots,
  assertAllowedMediaPath,
};

/**
 * Lightweight "stack-top hard anchor": on first verify failure, pin the model
 * to the top project source frame from pytest/unittest traceback.
 * Not an LSP — zero index work.
 */

function isThirdPartyPath(p) {
  const s = String(p || "").replace(/\\/g, "/");
  return (
    /site-packages\//i.test(s) ||
    /dist-packages\//i.test(s) ||
    /\/lib\/python\d/i.test(s) ||
    /<frozen /i.test(s) ||
    /\/pytest\//i.test(s) ||
    /\/_pytest\//i.test(s) ||
    /\/pluggy\//i.test(s) ||
    /\/unittest\//i.test(s)
  );
}

function toWorkspaceRel(filePath, workspace = "") {
  let p = String(filePath || "").replace(/\\/g, "/").trim();
  if (!p) return "";
  // Strip container prefixes
  p = p.replace(/^\/testbed\//, "").replace(/^\/home\/[^/]+\/[^/]+\//, "");
  const ws = String(workspace || "")
    .replace(/\\/g, "/")
    .replace(/\/$/, "");
  if (ws && p.toLowerCase().startsWith(ws.toLowerCase() + "/")) {
    p = p.slice(ws.length + 1);
  }
  // Drop drive-absolute that isn't under workspace
  if (/^[A-Za-z]:\//.test(p)) return "";
  if (p.startsWith("/")) {
    // absolute posix outside testbed — reject
    if (!p.startsWith("/testbed/")) return "";
    p = p.replace(/^\/testbed\//, "");
  }
  return p.replace(/^\.\//, "");
}

/**
 * @returns {{ path: string, line: number } | null}
 */
function extractStackAnchor(log, { workspace = "" } = {}) {
  const text = String(log || "");
  if (!text.trim()) return null;
  const lines = text.split(/\r?\n/);
  const fileRe = /^\s*File "([^"]+)", line (\d+)/;
  const colonRe = /^\s*([A-Za-z0-9_./\\-]+\.py):(\d+)(?::\d+)?:/;

  const candidates = [];
  for (const line of lines) {
    let m = fileRe.exec(line);
    if (m) {
      candidates.push({ raw: m[1], line: Number(m[2]) || 0 });
      continue;
    }
    m = colonRe.exec(line);
    if (m) candidates.push({ raw: m[1], line: Number(m[2]) || 0 });
  }

  for (const c of candidates) {
    if (!c.line || c.line < 1) continue;
    if (isThirdPartyPath(c.raw)) continue;
    const rel = toWorkspaceRel(c.raw, workspace);
    if (!rel || isThirdPartyPath(rel)) continue;
    if (!/\.(py|js|ts|tsx|jsx)$/i.test(rel)) continue;
    return { path: rel, line: c.line };
  }
  return null;
}

function buildAnchorInjection(anchor, fileSliceText) {
  const { path: rel, line } = anchor;
  return [
    "### HARD ANCHOR (first verify failure — do not ignore)",
    `Runtime failure points at \`${rel}:${line}\`.`,
    "Read this slice first. Prefer fixing the function containing this line.",
    "Do not switch to unrelated files unless the stack clearly requires it.",
    "",
    fileSliceText || `(failed to read ${rel})`,
  ].join("\n");
}

module.exports = {
  isThirdPartyPath,
  toWorkspaceRel,
  extractStackAnchor,
  buildAnchorInjection,
};

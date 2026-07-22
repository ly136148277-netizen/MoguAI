/**
 * Phase-3 strategy hints (NO gold: no line numbers, literals, file paths, or APIs from the issue).
 *
 * Profiles (MOGU_GEN_HINT_PROFILE):
 *   - (default / empty): instance map only (14182 / 14365 phase-3 targets)
 *   - integrity_v1: ONE universal integrity checklist for ANY instance
 *     (controlled trials — must not name repos, symbols, or “check callers of X”)
 *
 * Enabled when MOGU_GEN_HINTS=1.
 */

/** Universal — used by controlled trials on flask-4045 / sympy-11897 / future cases. */
const UNIVERSAL_INTEGRITY_HINT_V1 = [
  "[策略提示] 在你确认当前补丁能解决报错或验证失败之后，请再检查一遍：",
  "(1) 这个改动是否可能影响调用方或其他依赖此逻辑的代码；",
  "(2) 当前测试要求的功能是否已完整覆盖，而不只是覆盖了报错本身。",
  "如发现遗漏或可能的回归，请先补充修改或收窄改动，再结束。",
].join("\n");

/** @type {Record<string, string>} */
const HINTS_BY_INSTANCE = {
  "astropy__astropy-14182": [
    "[策略提示] 你刚刚为某个类添加了一个新的初始化参数（如 header_rows 或类似配置）。",
    "请检查：这个新参数是否只在 __init__ 中被赋值，而没有在数据读取（如 read 方法）或初始化（如 start_line 赋值）中生效？",
    "如果存在“参数已定义但未使用”的情况，请补充对应的初始化逻辑，确保新参数能真正控制数据解析行为。",
  ].join("\n"),

  "astropy__astropy-14365": [
    "[策略提示] 你在本次补丁中将一处字符串比较修改为忽略大小写（如添加了 re.IGNORECASE 或 .lower()）。",
    "请检查同一函数或同一代码块中，是否还有其他字符串字面量比较（如 if x == \"NO\"、if y == \"YES\"）尚未同步忽略大小写？",
    "如有，请一并统一修改，确保该函数内的字符串比较行为一致。",
  ].join("\n"),
};

function genHintsEnabled() {
  return process.env.MOGU_GEN_HINTS === "1";
}

function getHintProfile() {
  return String(process.env.MOGU_GEN_HINT_PROFILE || "")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} instanceId
 * @returns {string|null}
 */
function getGenericHint(instanceId) {
  if (!genHintsEnabled()) return null;
  const profile = getHintProfile();
  if (profile === "integrity_v1") {
    return UNIVERSAL_INTEGRITY_HINT_V1;
  }
  const id = String(instanceId || "").trim();
  if (!id) return null;
  return HINTS_BY_INSTANCE[id] || null;
}

/**
 * Extra system-prompt lines for profiles that must apply even when verify passes first try
 * (e.g. F2P✓ / P2P✗ regressions never hit the fail-injection path).
 * @returns {string|null}
 */
function getSystemHintAppendix() {
  if (!genHintsEnabled()) return null;
  if (getHintProfile() === "integrity_v1") return UNIVERSAL_INTEGRITY_HINT_V1;
  return null;
}

module.exports = {
  HINTS_BY_INSTANCE,
  UNIVERSAL_INTEGRITY_HINT_V1,
  genHintsEnabled,
  getHintProfile,
  getGenericHint,
  getSystemHintAppendix,
};

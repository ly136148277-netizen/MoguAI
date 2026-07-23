/**
 * MOGU AI coding — product keys and labels.
 * The desktop app only knows moguai runtimes; no third-party product identity.
 */

const ENGINE_A = "moguai_a";
const ENGINE_B = "moguai_b";

const ENGINE_META = Object.freeze({
  [ENGINE_A]: {
    key: ENGINE_A,
    short: "引擎 A",
    label: "MOGU AI 编程 · 引擎 A",
    hint: "主引擎",
    cliName: "moguai-coding-a",
    runtimeDir: "moguai-runtime-a",
  },
  [ENGINE_B]: {
    key: ENGINE_B,
    short: "引擎 B",
    label: "MOGU AI 编程 · 引擎 B",
    hint: "备选引擎",
    cliName: "moguai-coding-b",
    runtimeDir: "moguai-runtime-b",
  },
});

function normalizeEngineKey(engine) {
  const e = String(engine || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "");
  if (
    e === ENGINE_B ||
    e === "b" ||
    e === "引擎b" ||
    e.includes("引擎b") ||
    e === "engine_b" ||
    e === "engineb"
  ) {
    return ENGINE_B;
  }
  return ENGINE_A;
}

function engineLabel(engine) {
  return ENGINE_META[normalizeEngineKey(engine)].label;
}

function engineShort(engine) {
  return ENGINE_META[normalizeEngineKey(engine)].short;
}

function otherEngineKey(engine) {
  return normalizeEngineKey(engine) === ENGINE_B ? ENGINE_A : ENGINE_B;
}

function engineMeta(engine) {
  return ENGINE_META[normalizeEngineKey(engine)];
}

const api = {
  ENGINE_A,
  ENGINE_B,
  ENGINE_META,
  ENGINE_BRANDS: ENGINE_META,
  normalizeEngineKey,
  engineLabel,
  engineShort,
  otherEngineKey,
  engineMeta,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

if (typeof window !== "undefined") {
  window.MoguCodingBrands = api;
  window.MoguaiCoding = api;
}

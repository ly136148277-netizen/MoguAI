const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  ENGINE_A,
  ENGINE_B,
  engineLabel,
  engineShort,
  normalizeEngineKey,
  otherEngineKey,
} = require("../src/shared/moguai-coding");

describe("moguai coding brands", () => {
  it("maps moguai keys to product labels", () => {
    assert.equal(ENGINE_A, "moguai_a");
    assert.equal(ENGINE_B, "moguai_b");
    assert.match(engineLabel(ENGINE_A), /MOGU AI/);
    assert.match(engineLabel(ENGINE_B), /引擎 B/);
    assert.equal(engineShort(ENGINE_A), "引擎 A");
    assert.equal(normalizeEngineKey("引擎 B"), ENGINE_B);
    assert.equal(normalizeEngineKey("moguai_b"), ENGINE_B);
    assert.equal(otherEngineKey(ENGINE_A), ENGINE_B);
  });
});

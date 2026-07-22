const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getGenericHint,
  getSystemHintAppendix,
  getHintProfile,
  HINTS_BY_INSTANCE,
  UNIVERSAL_INTEGRITY_HINT_V1,
} = require("../src/main/skills/coding-gen-hints");

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("getGenericHint gated by MOGU_GEN_HINTS", () => {
  withEnv({ MOGU_GEN_HINTS: "0", MOGU_GEN_HINT_PROFILE: undefined }, () => {
    assert.equal(getGenericHint("astropy__astropy-14182"), null);
  });
  withEnv({ MOGU_GEN_HINTS: "1", MOGU_GEN_HINT_PROFILE: undefined }, () => {
    const h = getGenericHint("astropy__astropy-14182");
    assert.ok(h);
    assert.match(h, /策略提示/);
    assert.doesNotMatch(h, /self\.data\.start_line\s*=\s*2/);
    assert.doesNotMatch(h, /v\.upper\(\)\s*==\s*["']NO["']/);
    const h2 = getGenericHint("astropy__astropy-14365");
    assert.ok(h2);
    assert.match(h2, /IGNORECASE|\.lower\(\)/);
    assert.equal(getGenericHint("django__django-10924"), null);
  });
});

test("hint map covers only the two phase3 targets", () => {
  assert.deepEqual(Object.keys(HINTS_BY_INSTANCE).sort(), [
    "astropy__astropy-14182",
    "astropy__astropy-14365",
  ]);
});

test("integrity_v1 is universal — same text for any id, no gold", () => {
  withEnv({ MOGU_GEN_HINTS: "1", MOGU_GEN_HINT_PROFILE: "integrity_v1" }, () => {
    assert.equal(getHintProfile(), "integrity_v1");
    const a = getGenericHint("pallets__flask-4045");
    const b = getGenericHint("sympy__sympy-11897");
    const c = getGenericHint("django__django-10924");
    assert.equal(a, UNIVERSAL_INTEGRITY_HINT_V1);
    assert.equal(b, a);
    assert.equal(c, a);
    assert.doesNotMatch(a, /flask|sympy|blueprints|_print_set|4045|11897/i);
    assert.match(a, /调用方/);
    assert.match(a, /完整覆盖/);
    assert.equal(getSystemHintAppendix(), UNIVERSAL_INTEGRITY_HINT_V1);
  });
  withEnv({ MOGU_GEN_HINTS: "0", MOGU_GEN_HINT_PROFILE: "integrity_v1" }, () => {
    assert.equal(getGenericHint("pallets__flask-4045"), null);
    assert.equal(getSystemHintAppendix(), null);
  });
});

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  normalizeSteps,
  normalizeUrl,
  resolvePlaywrightHint,
} = require("../src/main/skills/browser-engine");
const memory = require("../src/main/skills/handlers/memory");
const { getSkillDef } = require("../src/main/skills/registry");
const { describeRisk } = require("../src/shared/butler-risk");
const { autoPersistMemory } = require("../src/main/agent-brain");

describe("browser act planning", () => {
  it("normalizes url and multi-step plans", () => {
    assert.equal(normalizeUrl("example.com"), "https://example.com");
    const steps = normalizeSteps({
      url: "https://example.com/login",
      steps: [
        { action: "fill", selector: "#user", value: "a" },
        { action: "click", selector: "button[type=submit]" },
        { action: "extract", selector: "body" },
      ],
    });
    assert.equal(steps.length, 3);
    assert.equal(steps[0].action, "fill");
    const clickOnly = normalizeSteps({
      op: "click",
      url: "https://example.com",
      selector: "#go",
    });
    assert.ok(clickOnly.some((s) => s.action === "goto"));
    assert.ok(clickOnly.some((s) => s.action === "click"));
  });

  it("registry exposes act/click/fill", () => {
    const def = getSkillDef("mogu.browser");
    assert.ok(def.ops.includes("act"));
    assert.ok(def.ops.includes("click"));
    assert.ok(def.ops.includes("fill"));
  });

  it("playwright probe returns fixCommands when missing vendor", () => {
    const probe = resolvePlaywrightHint({ codingVendorRoot: path.join(os.tmpdir(), "no-pw-vendor") });
    assert.ok(probe.message);
    assert.ok(Array.isArray(probe.fixCommands));
  });
});

describe("memory layers + auto persist", () => {
  it("stores layer on remember and filters recall", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-mem2-"));
    const deps = { userDataPath: dir };
    await memory.remember({
      deps,
      args: { key: "theme", value: "深色", layer: "preference" },
    });
    await memory.remember({
      deps,
      args: { key: "root", value: "E:\\projects\\PAI", layer: "project" },
    });
    const st = await memory.status({ deps });
    assert.ok(st.byLayer.preference >= 1);
    assert.ok(st.byLayer.project >= 1);
    const pref = await memory.recall({ deps, args: { query: "深色", layer: "preference" } });
    assert.ok(pref.facts.some((f) => f.layer === "preference"));
  });

  it("extractHighValueFacts picks explicit remember and paths", () => {
    const facts = memory.extractHighValueFacts(
      "请记住：默认用引擎 A。项目在 E:\\projects\\PAI",
      [],
      {}
    );
    assert.ok(facts.some((f) => f.layer === "preference" || /引擎 A|PAI/.test(f.value)));
    assert.ok(facts.some((f) => /E:\\\\projects\\\\PAI|E:\\projects\\PAI/.test(f.value) || f.key === "project_path"));
  });

  it("autoPersistMemory writes via skillRuntime", async () => {
    const writes = [];
    const runtime = {
      invoke: async (skillId, op, args) => {
        writes.push({ skillId, op, args });
        return { ok: true };
      },
    };
    const saved = await autoPersistMemory(
      runtime,
      "请记住：我喜欢 DeepSeek",
      [],
      {}
    );
    assert.ok(saved.length >= 1);
    assert.ok(writes.some((w) => w.skillId === "mogu.memory" && w.op === "remember"));
  });
});

describe("permission copy", () => {
  it("describeRisk humanizes coding commit and browser act", () => {
    const commit = describeRisk(2, "mogu.coding.commit chore: x");
    assert.match(commit.title, /提交/);
    assert.ok(commit.nextHint || /下一步/.test(commit.detail));
    const act = describeRisk(2, "mogu.browser.act fill login");
    assert.match(act.title, /浏览器|网页/);
  });
});

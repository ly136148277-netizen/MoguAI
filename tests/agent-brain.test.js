const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeBaseUrl,
  API_PRESETS,
  chatWithBrain,
  runBrainAgent,
  mapToolNameToSkill,
  extractJsonObject,
  BRAIN_TOOLS,
} = require("../src/main/agent-brain");

describe("agent-brain", () => {
  it("normalizes base url trailing slash", () => {
    assert.equal(normalizeBaseUrl("https://api.deepseek.com/v1/"), "https://api.deepseek.com/v1");
  });

  it("exposes first-tier presets", () => {
    assert.ok(API_PRESETS.deepseek.baseUrl.includes("deepseek"));
    assert.ok(API_PRESETS.openai.model);
    assert.ok(API_PRESETS.qwen.baseUrl.includes("dashscope"));
  });

  it("builtin channel returns null content for caller fallback", async () => {
    const result = await chatWithBrain({
      settings: { agentBrainChannel: "builtin" },
      ollama: null,
      userText: "怎么用",
    });
    assert.equal(result.provider, "builtin");
    assert.equal(result.content, null);
  });

  it("maps tool names to skills and exposes brain tools", () => {
    assert.equal(mapToolNameToSkill("mogu_coding"), "mogu.coding");
    assert.equal(mapToolNameToSkill("mogu_pc"), "mogu.pc");
    assert.equal(mapToolNameToSkill("mogu_search"), "mogu.search");
    assert.ok(BRAIN_TOOLS.length >= 9);
    const comfy = BRAIN_TOOLS.find((t) => t.function.name === "mogu_comfy");
    assert.ok(comfy.function.parameters.properties.op.enum.includes("cancel"));
  });

  it("extractJsonObject parses fenced planner output", () => {
    const obj = extractJsonObject('好的\n```json\n{"tool":"mogu_pc","op":"open","args":{"app":"ComfyUI"}}\n```');
    assert.equal(obj.tool, "mogu_pc");
    assert.equal(obj.op, "open");
  });

  it("runBrainAgent passthrough on builtin", async () => {
    const result = await runBrainAgent({
      settings: { agentBrainChannel: "builtin" },
      userText: "打开 ComfyUI",
    });
    assert.equal(result.mode, "passthrough");
  });

  it("runBrainAgent invokes skill via mocked runtime (local json planner)", async () => {
    const calls = [];
    const skillRuntime = {
      invoke: async (skillId, op, args) => {
        calls.push({ skillId, op, args });
        if (skillId === "mogu.memory") return { ok: true, facts: [] };
        return { ok: true, skillId, op };
      },
    };
    // First round tool, second round reply
    let n = 0;
    const ollama = {
      chat: async () => {
        n += 1;
        if (n === 1) {
          return {
            message: {
              content: JSON.stringify({ tool: "mogu_coding", op: "status", args: {} }),
            },
          };
        }
        return { message: { content: JSON.stringify({ reply: "Codex 已探测完成" }) } };
      },
    };

    const result = await runBrainAgent({
      settings: { agentBrainChannel: "local", agentLocalModel: "demo" },
      ollama,
      skillRuntime,
      userText: "编程引擎好了吗",
      maxRounds: 3,
    });
    assert.equal(result.ok, true);
    assert.ok(calls.some((c) => c.skillId === "mogu.memory" && c.op === "recall"));
    const coding = calls.find((c) => c.skillId === "mogu.coding");
    assert.ok(coding);
    assert.equal(coding.op, "status");
    assert.match(result.content, /探测|完成/);
  });
});

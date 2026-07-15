const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeBaseUrl, API_PRESETS, chatWithBrain } = require("../src/main/agent-brain");

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
});

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildBrainContent } = require("../src/main/agent-brain");

describe("buildBrainContent coding summary", () => {
  it("appends review summary and file count", () => {
    const text = buildBrainContent(
      [
        {
          tool: "mogu_coding",
          op: "run",
          ok: true,
          canCommit: true,
          review: { summary: "改了 2 个文件", fileCount: 2 },
        },
      ],
      ""
    );
    assert.match(text, /已执行 1 步/);
    assert.match(text, /改了 2 个文件/);
    assert.match(text, /改动文件 2/);
    assert.match(text, /精密工厂/);
  });

  it("falls back when no steps", () => {
    assert.equal(buildBrainContent([], "空"), "空");
  });
});

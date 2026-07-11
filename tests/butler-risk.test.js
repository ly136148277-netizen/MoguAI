const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assess,
  buildConfirmedCommand,
  detectRequiredLevel,
  assessPaiResponse,
} = require("../src/shared/butler-risk");

test("detectRequiredLevel marks delete as L3", () => {
  assert.equal(detectRequiredLevel("删除 test.txt"), 3);
  assert.equal(detectRequiredLevel("批量移动 downloads"), 3);
});

test("detectRequiredLevel marks backup and render as L2", () => {
  assert.equal(detectRequiredLevel("备份 PAI"), 2);
  assert.equal(detectRequiredLevel("确认出片 demo"), 2);
  assert.equal(detectRequiredLevel("打开 ComfyUI"), 1);
});

test("assess requires confirm for L2 without prefix", () => {
  const result = assess("备份 PAI", 2);
  assert.equal(result.needsConfirm, true);
  assert.equal(result.confirmedCommand, "确认备份 PAI");
});

test("assess requires level upgrade when session is L1", () => {
  const result = assess("备份 PAI", 1);
  assert.equal(result.needsConfirm, true);
  assert.equal(result.suggestedLevel, 2);
});

test("assess requires confirm for L3 delete", () => {
  const result = assess("删除 foo.txt", 3);
  assert.equal(result.needsConfirm, true);
  assert.equal(result.risk.severity, "high");
});

test("buildConfirmedCommand keeps existing prefix", () => {
  assert.equal(buildConfirmedCommand("确认千问换装"), "确认千问换装");
  assert.equal(buildConfirmedCommand("出片 demo"), "确认出片 demo");
});

test("assessPaiResponse maps needs_confirm", () => {
  const result = assessPaiResponse("出片 demo", {
    needs_confirm: true,
    error: "出片需要确认",
    hint: "请说确认出片 demo",
  });
  assert.ok(result);
  assert.equal(result.needsConfirm, true);
  assert.equal(result.confirmedCommand, "确认出片 demo");
});

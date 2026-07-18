const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeQueueEntry,
  collectPromptIds,
  detectNewPromptId,
  summarizeProgress,
  cancelComfyUiJob,
  supportsTargetedInterrupt,
  compareSemver,
  MIN_TARGETED_INTERRUPT_VERSION,
} = require("../src/main/comfyui-bridge");

test("normalizeQueueEntry parses array queue item", () => {
  const item = normalizeQueueEntry([1, "abc-123", {}, null, ["9:SaveImage"]]);
  assert.equal(item.promptId, "abc-123");
  assert.deepEqual(item.outputsToExecute, ["9:SaveImage"]);
});

test("detectNewPromptId finds prompt not in baseline", () => {
  const queue = {
    queue_running: [[1, "new-id", {}, null, []]],
    queue_pending: [],
  };
  const baseline = new Set(["old-id"]);
  assert.equal(detectNewPromptId(queue, baseline), "new-id");
});

test("summarizeProgress reports running phase", () => {
  const progress = summarizeProgress({
    queueData: {
      queue_running: [[1, "pid-1", {}, null, ["12:KSampler"]]],
      queue_pending: [],
    },
    promptId: "pid-1",
    elapsedMs: 65000,
  });
  assert.equal(progress.phase, "running");
  assert.match(progress.message, /运行中/);
  assert.equal(progress.currentNode, "12:KSampler");
});

test("summarizeProgress reports completed from history outputs", () => {
  const progress = summarizeProgress({
    queueData: { queue_running: [], queue_pending: [] },
    historyItem: { outputs: { "9": { images: [{ filename: "out.png" }] } } },
    promptId: "pid-1",
    elapsedMs: 120000,
  });
  assert.equal(progress.phase, "completed");
  assert.match(progress.message, /已完成/);
});

test("collectPromptIds gathers running and pending", () => {
  const ids = collectPromptIds({
    queue_running: [[1, "a", {}, null, []]],
    queue_pending: [[2, "b", {}, null, []]],
  });
  assert.deepEqual([...ids].sort(), ["a", "b"]);
});

test("cancelComfyUiJob fails clearly when ComfyUI API is not configured", async () => {
  const result = await cancelComfyUiJob(pathJoinNonexistent());
  assert.equal(result.ok, false);
  assert.match(result.error, /未配置|ComfyUI/);
});

test("supportsTargetedInterrupt gates on ComfyUI 0.3.56+", () => {
  assert.equal(MIN_TARGETED_INTERRUPT_VERSION, "0.3.56");
  assert.equal(supportsTargetedInterrupt("0.3.55"), false);
  assert.equal(supportsTargetedInterrupt("0.3.56"), true);
  assert.equal(supportsTargetedInterrupt("0.28.0"), true);
  assert.equal(supportsTargetedInterrupt(""), false);
  assert.equal(supportsTargetedInterrupt(null), false);
  assert.equal(compareSemver("0.3.56", "0.3.56"), 0);
});

function pathJoinNonexistent() {
  const path = require("path");
  const os = require("os");
  return path.join(os.tmpdir(), "mogu-no-pai-root-" + Date.now());
}

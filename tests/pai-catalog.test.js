const test = require("node:test");
const assert = require("node:assert/strict");
const { mergePresets, FALLBACK_PRESETS, PRESET_COMMANDS } = require("../src/shared/pai-catalog");

const EXPECTED_PRESET_IDS = ["qwen_edit", "zimage", "ltx_i2v", "video_ltx", "ace_music"];

test("FALLBACK_PRESETS matches PAI PRESET_COMMANDS (5 verified workflows)", () => {
  assert.equal(FALLBACK_PRESETS.length, 5);
  assert.deepEqual(FALLBACK_PRESETS.map((row) => row.id), EXPECTED_PRESET_IDS);
  for (const row of FALLBACK_PRESETS) {
    assert.equal(row.command, PRESET_COMMANDS[row.id], `command drift for ${row.id}`);
    assert.ok(row.workflow, `missing workflow for ${row.id}`);
  }
});

test("mergePresets falls back when remote empty", () => {
  const merged = mergePresets([]);
  assert.equal(merged.length, FALLBACK_PRESETS.length);
});

test("mergePresets keeps fallback notes", () => {
  const merged = mergePresets([{ id: "qwen_edit", label: "千问换装", command: "确认千问换装", workflow: "qwen_image_edit" }]);
  assert.equal(merged[0].command, "确认千问换装");
  assert.match(merged[0].note, /141s/);
});

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");

const { splitRanges, formatSpeed, formatEta, computeSha256, mergePartFiles } = require("../src/main/download-engine");

describe("DownloadEngine helpers", () => {
  it("splits byte ranges for multi-thread download", () => {
    const parts = splitRanges(1000, 4);
    assert.equal(parts.length, 4);
    assert.equal(parts[0].start, 0);
    assert.equal(parts[0].end, 249);
    assert.equal(parts[3].end, 999);
  });

  it("formats speed and eta", () => {
    assert.match(formatSpeed(1024 * 1024 * 2), /MB\/s/);
    assert.match(formatEta(130), /2分10秒/);
  });

  it("merges part files and verifies sha256", async () => {
    const tempDir = path.join(os.tmpdir(), `dl-test-${Date.now()}`);
    await fs.ensureDir(tempDir);

    const part1 = path.join(tempDir, "part-0");
    const part2 = path.join(tempDir, "part-1");
    const merged = path.join(tempDir, "merged.bin");
    await fs.writeFile(part1, "hello ");
    await fs.writeFile(part2, "world");

    await mergePartFiles([part1, part2], merged);
    const content = await fs.readFile(merged, "utf-8");
    assert.equal(content, "hello world");

    const hash = await computeSha256(merged);
    assert.equal(hash.length, 64);

    await fs.remove(tempDir);
  });
});

describe("SettingsStore", () => {
  const { SettingsStore } = require("../src/main/settings");
  let settingsPath;

  before(async () => {
    settingsPath = path.join(os.tmpdir(), `settings-${Date.now()}.json`);
  });

  after(async () => {
    await fs.remove(settingsPath);
  });

  it("loads defaults and toggles favorites", async () => {
    const store = new SettingsStore(settingsPath);
    const settings = await store.load();
    assert.equal(settings.downloadThreads, 4);
    await store.toggleFavorite("demo-model");
    const next = await store.load();
    assert.deepEqual(next.favorites, ["demo-model"]);
    await store.toggleFavorite("demo-model");
    assert.deepEqual((await store.load()).favorites, []);
  });
});

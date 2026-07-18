const test = require("node:test");
const assert = require("node:assert/strict");
const { findDenylistHits } = require("../build/asar-denylist");

test("denylist catches github.token and news configs", () => {
  const hits = findDenylistHits([
    "package.json",
    "config/prompts.json",
    "config/github.token",
    "config/mogu_daily_news.json",
    "config/xuzhou_pois.json",
    "scripts/publish_mogu_releases.ps1",
    "src/main/main.js",
    ".env",
    "secrets.json",
  ]);
  assert.deepEqual(hits, [
    ".env",
    "config/github.token",
    "config/mogu_daily_news.json",
    "config/xuzhou_pois.json",
    "scripts/publish_mogu_releases.ps1",
    "secrets.json",
  ]);
});

test("denylist allows runtime whitelist paths", () => {
  const hits = findDenylistHits([
    "package.json",
    "models.json",
    "config/prompts.json",
    "config/repository.json",
    "config/update.json",
    "catalog/models.json",
    "src/main/main.js",
    "assets/icon.png",
  ]);
  assert.deepEqual(hits, []);
});

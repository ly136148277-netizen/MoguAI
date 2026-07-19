const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  listMcpPresets,
  normalizeServerEntry,
  mergePresetIntoServers,
} = require("../src/main/mcp-presets");

describe("mcp presets form helpers", () => {
  it("lists recommended presets", () => {
    const presets = listMcpPresets();
    assert.ok(presets.length >= 3);
    assert.ok(presets.every((p) => p.id && p.command && Array.isArray(p.args)));
  });

  it("normalizes and merges preset into servers", () => {
    const entry = normalizeServerEntry({
      id: "demo!",
      command: "npx",
      args: "-y @modelcontextprotocol/server-everything",
      enabled: true,
    });
    assert.equal(entry.id, "demo_");
    assert.deepEqual(entry.args, ["-y", "@modelcontextprotocol/server-everything"]);

    const merged = mergePresetIntoServers([], "everything");
    assert.equal(merged.ok, true);
    assert.equal(merged.servers.length, 1);
    assert.equal(merged.servers[0].id, "everything");
    assert.equal(merged.servers[0].enabled, true);

    const again = mergePresetIntoServers(merged.servers, "everything");
    assert.equal(again.servers.length, 1);

    const bad = mergePresetIntoServers([], "nope");
    assert.equal(bad.ok, false);
  });
});

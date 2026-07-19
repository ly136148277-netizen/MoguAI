const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { BRAIN_TOOLS, mapToolNameToSkill } = require("../src/main/agent-brain");
const { SKILL_IDS, SKILL_META, buildBrainToolsFromRegistry } = require("../src/main/skills/registry");
const memory = require("../src/main/skills/handlers/memory");
const search = require("../src/main/skills/handlers/search");
const { McpManager } = require("../src/main/mcp-client");

describe("capability expand", () => {
  it("registry includes search/browser/memory and brain tools cover all ops", () => {
    assert.ok(SKILL_IDS.includes("mogu.search"));
    assert.ok(SKILL_IDS.includes("mogu.browser"));
    assert.ok(SKILL_IDS.includes("mogu.memory"));
    assert.equal(SKILL_IDS.length, 9);

    const tools = buildBrainToolsFromRegistry();
    assert.equal(tools.length, 9);
    for (const id of SKILL_IDS) {
      const tool = tools.find((t) => t.function.name === id.replace(/\./g, "_"));
      assert.ok(tool, `missing tool for ${id}`);
      assert.deepEqual(tool.function.parameters.properties.op.enum, SKILL_META[id].ops);
    }

    const comfy = BRAIN_TOOLS.find((t) => t.function.name === "mogu_comfy");
    assert.ok(comfy.function.parameters.properties.op.enum.includes("cancel"));
    const coding = BRAIN_TOOLS.find((t) => t.function.name === "mogu_coding");
    assert.ok(coding.function.parameters.properties.op.enum.includes("preflight"));
    assert.ok(coding.function.parameters.properties.op.enum.includes("trajectory"));
    assert.equal(mapToolNameToSkill("mogu_search"), "mogu.search");
    assert.equal(mapToolNameToSkill("mogu_memory"), "mogu.memory");
  });

  it("memory remember/recall/forget roundtrip", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-mem-"));
    const deps = { userDataPath: dir };
    const saved = await memory.remember({
      deps,
      args: { key: "project", value: "PAI 在 E:\\projects\\PAI", tags: "pai" },
    });
    assert.equal(saved.ok, true);
    const hit = await memory.recall({ deps, args: { query: "PAI" } });
    assert.equal(hit.ok, true);
    assert.ok(hit.facts.some((f) => f.key === "project"));
    const forgot = await memory.forget({ deps, args: { key: "project" } });
    assert.equal(forgot.removed, 1);
  });

  it("search pickQuery and status", async () => {
    assert.equal(search.pickQuery({ query: "hello" }), "hello");
    const st = await search.status();
    assert.equal(st.backend, "duckduckgo");
  });

  it("mcp manager normalizes servers and rejects bad tool names", async () => {
    const mgr = new McpManager();
    const servers = mgr.normalizeServers({
      mcpServers: [
        { id: "demo", command: "echo", args: [], enabled: true },
        { id: "off", command: "x", enabled: false },
      ],
    });
    assert.equal(servers.length, 1);
    assert.equal(servers[0].id, "demo");
    const bad = await mgr.call({ mcpServers: servers }, "not_mcp", {});
    assert.equal(bad.ok, false);
  });
});

/**
 * Recommended MCP servers for the settings form (not auto-enabled).
 * Users add via UI; brains see them as mcp__{id}__{tool}.
 */

const MCP_PRESETS = Object.freeze([
  {
    id: "filesystem",
    label: "Filesystem",
    description: "读写指定目录（请把 args 最后一项改成你的安全目录）",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "D:\\safe-folder"],
    enabled: false,
  },
  {
    id: "memory",
    label: "Memory (MCP)",
    description: "官方 memory server（与 mogu.memory 可并存，用途不同）",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    enabled: false,
  },
  {
    id: "everything",
    label: "Everything（探测用）",
    description: "官方示例 server，适合测 MCP 连通",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    enabled: false,
  },
  {
    id: "fetch",
    label: "Fetch",
    description: "HTTP 抓取（与 mogu.browser.fetch 互补）",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    enabled: false,
  },
]);

function listMcpPresets() {
  return MCP_PRESETS.map((p) => ({ ...p, args: [...p.args] }));
}

function normalizeServerEntry(raw = {}) {
  const id = String(raw.id || raw.name || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 40);
  if (!id) return null;
  const command = String(raw.command || "").trim();
  if (!command) return null;
  let args = raw.args;
  if (typeof args === "string") {
    args = args
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(args)) args = [];
  return {
    id,
    label: String(raw.label || raw.name || id).trim() || id,
    command,
    args: args.map(String),
    env: raw.env && typeof raw.env === "object" ? raw.env : {},
    shell: raw.shell === true,
    enabled: raw.enabled !== false,
  };
}

function mergePresetIntoServers(servers, presetId) {
  const preset = MCP_PRESETS.find((p) => p.id === presetId);
  if (!preset) return { ok: false, error: `未知推荐：${presetId}`, servers };
  const list = Array.isArray(servers) ? [...servers] : [];
  const existing = list.findIndex((s) => s && s.id === preset.id);
  const entry = normalizeServerEntry({ ...preset, enabled: true });
  if (existing >= 0) list[existing] = { ...list[existing], ...entry, enabled: true };
  else list.push(entry);
  return { ok: true, servers: list, added: entry };
}

module.exports = {
  MCP_PRESETS,
  listMcpPresets,
  normalizeServerEntry,
  mergePresetIntoServers,
};

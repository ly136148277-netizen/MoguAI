const { canonicalRoot, createRepoIndex } = require("../intelligence/repo-index");
const { discoverTests } = require("../intelligence/test-discovery");

const repoIndexes = new Map();

function getRepoIndex(workspace) {
  const root = canonicalRoot(workspace);
  if (!repoIndexes.has(root)) repoIndexes.set(root, createRepoIndex(root));
  return repoIndexes.get(root);
}

function queryRepoIntelligence(workspace, query = {}) {
  const index = getRepoIndex(workspace);
  const op = String(query.op || "stats");
  if (op === "refresh" || op === "stats") return index.update();
  if (op === "files") return { ok: true, result: index.listFiles() };
  if (op === "symbols") return { ok: true, result: index.getSymbols(query.path) };
  if (op === "definitions") return { ok: true, result: index.findDefinitions(query.symbol) };
  if (op === "references") return { ok: true, result: index.findReferences(query.symbol, query) };
  if (op === "imports") return { ok: true, result: index.getImports(query.path) };
  if (op === "importers") return { ok: true, result: index.getImporters(query.path) };
  if (op === "calls") return { ok: true, result: index.getCallEdges(query.symbol) };
  const error = new Error(`unknown repo intelligence op: ${op}`);
  error.code = "invalid_operation";
  throw error;
}

module.exports = {
  ...require("./workspace-fs"),
  ...require("./debug-session"),
  ...require("../terminal/session-manager"),
  ...require("../worktree/worktree-manager"),
  ...require("../runtime"),
  getRepoIndex,
  queryRepoIntelligence,
  discoverWorkspaceTests: discoverTests,
};

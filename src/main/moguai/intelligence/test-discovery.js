const fs = require("node:fs");
const path = require("node:path");
const { canonicalRoot } = require("./repo-index");
const { listRepoFiles, normalizeRel } = require("../../skills/coding-scope");

function quoteArg(value) {
  const text = String(value || "");
  return `"${text.replace(/(["\\$`])/g, "\\$1")}"`;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function discoverTests(workspace, options = {}) {
  const root = canonicalRoot(workspace);
  const maxFiles = Math.min(10_000, Math.max(1, Number(options.maxFiles) || 5000));
  const files = listRepoFiles(root, { max: maxFiles }).map(normalizeRel).filter(Boolean);
  const set = new Set(files);
  const tests = [];
  const verifyStages = [];
  const seenCommands = new Set();

  const add = (framework, file, command) => {
    if (file) tests.push({ framework, path: file });
    if (command && !seenCommands.has(command)) {
      seenCommands.add(command);
      verifyStages.push({ name: `verify:${framework}`, command });
    }
  };

  const pkg = set.has("package.json") ? readJson(path.join(root, "package.json")) : null;
  const nodeDeps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const hasJest = Boolean(nodeDeps.jest) || files.some((file) => /(^|\/)jest\.config\./.test(file));
  const nodeFiles = files.filter((file) =>
    /(^|\/)(?:test|tests|__tests__)(\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)
  );
  if (pkg?.scripts?.test) {
    const framework = hasJest ? "jest" : "node";
    for (const file of nodeFiles) add(framework, file, null);
    add(framework, null, "npm test");
  } else if (hasJest) {
    for (const file of nodeFiles) add("jest", file, null);
    add("jest", null, "npx --no-install jest");
  } else {
    for (const file of nodeFiles) add("node", file, `node --test ${quoteArg(file)}`);
  }

  const pyFiles = files.filter((file) =>
    /(^|\/)(?:test_[^/]+|[^/]+_test)\.py$/.test(file)
  );
  if (pyFiles.length || set.has("pytest.ini") || set.has("pyproject.toml") || set.has("setup.cfg")) {
    for (const file of pyFiles) add("pytest", file, null);
    add("pytest", null, "python -m pytest");
  }

  const goFiles = files.filter((file) => /_test\.go$/.test(file));
  if (set.has("go.mod") || goFiles.length) {
    for (const file of goFiles) add("go", file, null);
    add("go", null, "go test ./...");
  }

  const rustFiles = files.filter((file) => /(^|\/)tests\/.+\.rs$/.test(file));
  if (set.has("Cargo.toml")) {
    for (const file of rustFiles) add("cargo", file, null);
    add("cargo", null, "cargo test");
  }

  return {
    ok: true,
    workspace: root,
    tests,
    verifyStages,
    // Alias accepted directly by normalizeVerifyStages callers.
    stages: verifyStages,
    frameworks: [...new Set(tests.map((item) => item.framework).concat(
      verifyStages.map((stage) => stage.name.replace(/^verify:/, ""))
    ))],
  };
}

module.exports = { discoverTests, quoteArg };

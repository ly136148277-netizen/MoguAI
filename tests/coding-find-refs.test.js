const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs-extra");
const os = require("os");
const { spawnSync } = require("node:child_process");
const {
  findReferences,
  buildRefsInjection,
  buildCallerBodyInjection,
  inferSymbol,
  isIgnoredPath,
} = require("../src/main/skills/coding-find-refs");

function initTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-refs-"));
  spawnSync("git", ["init"], { cwd: root, encoding: "utf8", windowsHide: true });
  spawnSync("git", ["config", "user.email", "t@t.t"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  spawnSync("git", ["config", "user.name", "t"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  fs.outputFileSync(
    path.join(root, "pkg", "core.py"),
    ["def target_fn(x):", "    return x + 1", "", "def other():", "    return target_fn(2)", ""].join(
      "\n"
    )
  );
  fs.outputFileSync(
    path.join(root, "pkg", "caller.py"),
    ["from pkg.core import target_fn", "", "def run():", "    return target_fn(9)", ""].join("\n")
  );
  spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8", windowsHide: true });
  spawnSync("git", ["commit", "-m", "init"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return root;
}

test("inferSymbol reads def name", () => {
  const s = inferSymbol("def target_fn(x):", "");
  assert.equal(s.name, "target_fn");
  assert.ok(s.col >= 0);
});

test("isIgnoredPath rejects site-packages", () => {
  assert.equal(
    isIgnoredPath("/usr/local/lib/python3.10/site-packages/django/foo.py", "/tmp/ws"),
    true
  );
});

test("findReferences locates callers via jedi or grep", () => {
  const root = initTempRepo();
  try {
    const abs = path.join(root, "pkg", "core.py");
    const r = findReferences({
      workspace: root,
      file_path: abs,
      line: 1,
      symbol_name: "target_fn",
      maxRefs: 12,
    });
    assert.ok(r.refs.length >= 1, `expected refs, got ${JSON.stringify(r)}`);
    assert.ok(
      r.refs.every((x) => !/site-packages/i.test(x.file)),
      "must stay inside repo"
    );
    const files = r.refs.map((x) => x.file.replace(/\\/g, "/"));
    assert.ok(
      files.some((f) => f.includes("caller.py") || f.includes("core.py")),
      `unexpected files: ${files.join(",")}`
    );
    const inj = buildRefsInjection({ file_path: "pkg/core.py", line: 1, result: r });
    assert.match(inj, /\[引用分析\]/);
    assert.match(inj, /调用者列表/);
    const bodies = buildCallerBodyInjection(root, r.refs, { maxBodies: 2, pad: 5 });
    assert.match(bodies, /空补丁加码/);
  } finally {
    fs.removeSync(root);
  }
});

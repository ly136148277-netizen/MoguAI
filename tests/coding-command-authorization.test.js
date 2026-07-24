const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCodingToolRunner } = require("../src/main/skills/coding-agent-tools");
const coding = require("../src/main/skills/handlers/coding");

function nodeCommand(source) {
  return `node -e ${JSON.stringify(source)}`;
}

test("coding run_tests denies before execution without command authorization", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-coding-auth-"));
  const marker = path.join(workspace, "should-not-exist.txt");
  const command = nodeCommand("require('fs').writeFileSync('should-not-exist.txt','bad')");
  try {
    const missing = createCodingToolRunner({ workspace, verifyCommand: command });
    const missingResult = await missing.execute("run_tests");
    assert.match(missingResult, /authorization_required/);
    assert.equal(fs.existsSync(marker), false);

    let payload = null;
    const denied = createCodingToolRunner({
      workspace,
      verifyCommand: command,
      authorizeCommand: async (request) => {
        payload = request;
        return { allowed: false, reason: "test_deny" };
      },
    });
    const deniedResult = await denied.execute("run_tests");
    assert.match(deniedResult, /authorization_denied/);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(payload.command, command);
    assert.equal(payload.cwd, workspace);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("coding run_tests preserves execution after scoped approval", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-coding-allow-"));
  try {
    const runner = createCodingToolRunner({
      workspace,
      verifyCommand: nodeCommand("process.stdout.write('AUTHORIZED_OK')"),
      authorizeCommand: async () => ({ allowed: true }),
    });
    const result = await runner.execute("run_tests");
    assert.match(result, /ok=true/);
    assert.match(result, /AUTHORIZED_OK/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("coding verify handler returns denial without spawning command", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-coding-handler-auth-"));
  const marker = path.join(workspace, "handler-should-not-exist.txt");
  try {
    const result = await coding.verify({
      deps: {
        settings: { codingWorkspace: workspace },
        permissionProxy: {
          requestPermission: async () => ({
            allowed: false,
            reason: "test_deny",
            message: "denied for test",
          }),
        },
      },
      args: {
        command: nodeCommand("require('fs').writeFileSync('handler-should-not-exist.txt','bad')"),
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.permissionDenied, true);
    assert.equal(result.reason, "test_deny");
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  TerminalSessionManager,
  buildControlledEnv,
} = require("../src/main/moguai/terminal/session-manager");
const { DEFAULT_SETTINGS } = require("../src/main/settings");

function createMockPty() {
  const spawned = [];
  return {
    spawned,
    spawn(executable, args, options) {
      let onData = () => {};
      let onExit = () => {};
      const handle = {
        pid: 4242,
        onData(callback) {
          onData = callback;
          return { dispose() {} };
        },
        onExit(callback) {
          onExit = callback;
          return { dispose() {} };
        },
        emitData(data) {
          onData(data);
        },
        emitExit(exitCode = 0, signal = 0) {
          onExit({ exitCode, signal });
        },
        kill() {
          queueMicrotask(() => onExit({ exitCode: null, signal: 9 }));
        },
      };
      spawned.push({ executable, args, options, handle });
      return handle;
    },
  };
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("v2.1 terminal and worktree capabilities default off", () => {
  assert.equal(DEFAULT_SETTINGS.v21ControlledTerminal, false);
  assert.equal(DEFAULT_SETTINGS.v21ParallelWorktrees, false);
});

test("controlled terminal fails closed on authorization denial", async () => {
  const root = tempDir("mogu-term-deny-");
  const pty = createMockPty();
  let permissionPayload;
  try {
    const manager = new TerminalSessionManager({
      allowedRoots: [root],
      authorize: async (payload) => {
        permissionPayload = payload;
        return { allowed: false, reason: "test_deny" };
      },
      pty,
    });
    await assert.rejects(
      manager.start({ executable: "node", args: ["--version"], cwd: root }),
      (error) => error.code === "authorization_denied"
    );
    assert.equal(pty.spawned.length, 0);
    assert.equal(permissionPayload.riskLevel, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("controlled environment strips secrets and non-allowlisted values", () => {
  const env = buildControlledEnv({
    source: { PATH: "safe-path", API_KEY: "host-secret", RANDOM_VALUE: "host" },
    requested: {
      FOO: "explicit",
      TOKEN: "requested-secret",
      RANDOM_VALUE: "requested-random",
    },
    allowlist: new Set(["PATH", "FOO", "TOKEN"]),
    inherit: new Set(["PATH", "API_KEY", "RANDOM_VALUE"]),
  });
  assert.deepEqual(env, { PATH: "safe-path", FOO: "explicit" });
  assert.equal(JSON.stringify(env).includes("secret"), false);
});

test("controlled terminal bounds output and supports cancellation", async () => {
  const root = tempDir("mogu-term-cancel-");
  const pty = createMockPty();
  try {
    const manager = new TerminalSessionManager({
      allowedRoots: [root],
      authorize: async () => ({ allowed: true }),
      pty,
      maxOutputBytes: 256,
      execFile: async () => ({ stdout: "", stderr: "" }),
    });
    const started = await manager.start({
      executable: "node",
      args: ["script.js", "value;still-one-argument"],
      cwd: root,
    });
    assert.deepEqual(pty.spawned[0].args, ["script.js", "value;still-one-argument"]);
    pty.spawned[0].handle.emitData(`prefix-${"x".repeat(500)}-tail`);
    await manager.cancel(started.id, "user_cancelled");
    const done = await manager.wait(started.id);
    assert.equal(done.status, "cancelled");
    assert.equal(done.reason, "user_cancelled");
    assert.equal(done.outputTruncated, true);
    assert.ok(Buffer.byteLength(done.output) <= 256);
    assert.match(done.output, /tail$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("controlled terminal enforces timeout", async () => {
  const root = tempDir("mogu-term-timeout-");
  const pty = createMockPty();
  try {
    const manager = new TerminalSessionManager({
      allowedRoots: [root],
      authorize: async () => true,
      pty,
      maxDurationMs: 25,
      execFile: async () => ({ stdout: "", stderr: "" }),
    });
    const started = await manager.start({
      executable: "node",
      args: [],
      cwd: root,
      durationMs: 15,
    });
    const done = await manager.wait(started.id);
    assert.equal(done.status, "timed_out");
    assert.equal(done.reason, "timeout");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("controlled terminal counts pending authorization against concurrency limit", async () => {
  const root = tempDir("mogu-term-limit-");
  const pty = createMockPty();
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  try {
    const manager = new TerminalSessionManager({
      allowedRoots: [root],
      authorize: async () => held,
      pty,
      maxConcurrent: 1,
    });
    const first = manager.start({ executable: "node", args: [], cwd: root });
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(
      manager.start({ executable: "node", args: [], cwd: root }),
      (error) => error.code === "session_limit"
    );
    release({ allowed: true });
    const started = await first;
    await manager.cancel(started.id);
    await manager.wait(started.id);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("controlled terminal rejects a junction escaping allowed roots", {
  skip: process.platform !== "win32" ? "Windows junction test" : false,
}, async () => {
  const root = tempDir("mogu-term-root-");
  const outside = tempDir("mogu-term-outside-");
  const junction = path.join(root, "escape");
  const pty = createMockPty();
  try {
    fs.symlinkSync(outside, junction, "junction");
    const manager = new TerminalSessionManager({
      allowedRoots: [root],
      authorize: async () => true,
      pty,
    });
    await assert.rejects(
      manager.start({ executable: "node", args: [], cwd: junction }),
      (error) => error.code === "cwd_not_allowed"
    );
    assert.equal(pty.spawned.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

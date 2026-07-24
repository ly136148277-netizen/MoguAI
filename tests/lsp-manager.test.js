const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const {
  LspManager,
  LspFramer,
  buildAllowlistedEnv,
} = require("../src/main/moguai/intelligence/lsp-manager");

function writeServer(root) {
  const file = path.join(root, "fake-lsp.js");
  fs.writeFileSync(file, `
let buffer = Buffer.alloc(0);
function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  process.stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n');
  process.stdout.write(body);
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf('\\r\\n\\r\\n');
    if (end < 0) return;
    const header = buffer.subarray(0, end).toString();
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) process.exit(2);
    const length = Number(match[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length));
    buffer = buffer.subarray(end + 4 + length);
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { capabilities: {} } });
    else if (message.method === 'test/env') send({ jsonrpc: '2.0', id: message.id, result: process.env });
    else if (message.method === 'test/hang') {}
    else if (message.method === 'test/crash') process.exit(7);
    else if (message.method === 'shutdown') send({ jsonrpc: '2.0', id: message.id, result: null });
    else if (message.id != null) send({ jsonrpc: '2.0', id: message.id, result: null });
    else if (message.method === 'exit') process.exit(0);
  }
});
`);
  return file;
}

test("LSP framer handles split messages and rejects oversized payloads", () => {
  const messages = [];
  const errors = [];
  const framer = new LspFramer({
    maxMessageBytes: 64,
    onMessage: (message) => messages.push(message),
    onError: (error) => errors.push(error),
  });
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }));
  const frame = Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
    body,
  ]);
  framer.push(frame.subarray(0, 12));
  framer.push(frame.subarray(12));
  assert.equal(messages[0].result, "ok");
  framer.push(Buffer.from("Content-Length: 999\r\n\r\n"));
  assert.match(errors[0].message, /exceeds limit/);
});

test("LSP environment inherits only allowlisted names", () => {
  const env = buildAllowlistedEnv(
    { PATH: "safe-path", SECRET_TOKEN: "leak" },
    { MOGU_LSP_TEST: "configured", SECRET_TOKEN: "override" },
    ["PATH", "MOGU_LSP_TEST"]
  );
  assert.deepEqual(env, { PATH: "safe-path", MOGU_LSP_TEST: "configured" });
  assert.equal(env.SECRET_TOKEN, undefined);
});

test("LSP lifecycle initializes, times out with cancellation, reports crash, and restarts once", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-lsp-"));
  const server = writeServer(root);
  const manager = new LspManager(
    {
      workspace: root,
      command: process.execPath,
      args: [server],
      env: { MOGU_LSP_TEST: "configured", SECRET_TOKEN: "must-not-pass" },
    },
    {
      requestTimeoutMs: 80,
      shutdownTimeoutMs: 100,
      envAllowlist: ["PATH", "Path", "SystemRoot", "ComSpec", "PATHEXT", "MOGU_LSP_TEST"],
    }
  );

  await manager.start();
  assert.equal(manager.state, "running");
  const env = await manager.request("test/env", {});
  assert.equal(env.MOGU_LSP_TEST, "configured");
  assert.equal(env.SECRET_TOKEN, undefined);
  await assert.rejects(
    manager.request("test/hang", {}),
    (error) => error.code === "request_timeout"
  );
  const controller = new AbortController();
  const cancelled = manager.request("test/hang", {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, (error) => error.code === "request_cancelled");

  const crashed = once(manager, "crash");
  await assert.rejects(manager.request("test/crash", {}), /exited/);
  const [event] = await crashed;
  assert.equal(event.code, 7);
  assert.equal(manager.state, "crashed");

  await manager.restartOnce();
  assert.equal(manager.state, "running");
  await assert.rejects(manager.restartOnce(), (error) => error.code === "restart_exhausted");
  await manager.stop();
  assert.equal(manager.state, "stopped");
});

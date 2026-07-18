const http = require("http");
const { WebSocketServer } = require("ws");

/**
 * Minimal OpenClaw-like Gateway for contract tests.
 * Supports connect handshake, sessions.create/send/abort, tasks.get/cancel, event stream.
 */
function createMockGateway(options = {}) {
  const requireToken = options.requireToken || null;
  const methods = options.methods || [
    "connect",
    "sessions.create",
    "sessions.send",
    "sessions.abort",
    "tasks.get",
    "tasks.cancel",
  ];
  const delayMs = Number(options.streamDelayMs) || 20;
  /** @type {Map<string, any>} */
  const tasks = new Map();
  let runCounter = 0;

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("mock-openclaw-gateway");
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    let authed = false;

    socket.send(
      JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "n1", ts: Date.now() },
      })
    );

    socket.on("message", (buf) => {
      let frame;
      try {
        frame = JSON.parse(String(buf));
      } catch {
        return;
      }
      if (frame.type !== "req") return;
      const { id, method, params } = frame;

      if (method === "connect") {
        const token = params?.auth?.token;
        if (requireToken && token !== requireToken) {
          socket.send(
            JSON.stringify({
              type: "res",
              id,
              ok: false,
              error: { code: "unauthorized", message: "invalid token" },
            })
          );
          return;
        }
        authed = true;
        socket.send(
          JSON.stringify({
            type: "res",
            id,
            ok: true,
            payload: {
              type: "hello-ok",
              protocol: 4,
              server: { version: "mock-0.1.0", connId: "mock-conn" },
              features: { methods, events: ["agent", "tick"] },
              auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
              policy: { maxPayload: 1024 * 1024, tickIntervalMs: 15000 },
            },
          })
        );
        return;
      }

      if (!authed) {
        socket.send(
          JSON.stringify({
            type: "res",
            id,
            ok: false,
            error: { code: "unauthorized", message: "not connected" },
          })
        );
        return;
      }

      if (method === "sessions.create") {
        const key = `session-${Date.now()}`;
        socket.send(
          JSON.stringify({
            type: "res",
            id,
            ok: true,
            payload: { key, sessionId: key, runStarted: false },
          })
        );
        return;
      }

      if (method === "sessions.send" || method === "chat.send") {
        runCounter += 1;
        const runId = `run-${runCounter}`;
        const taskId = `task-${runCounter}`;
        const sessionKey = params?.key || params?.sessionKey || "session-unknown";
        tasks.set(taskId, { id: taskId, runId, sessionKey, status: "running" });
        socket.send(
          JSON.stringify({
            type: "res",
            id,
            ok: true,
            payload: { runId, taskId, sessionKey },
          })
        );

        if (options.acceptOnly) {
          // Do not emit terminal — caller tests wait-timeout / no fallback.
          return;
        }

        setTimeout(() => {
          socket.send(
            JSON.stringify({
              type: "event",
              event: "agent",
              payload: { runId, sessionKey, text: "hello ", status: "running" },
            })
          );
        }, delayMs);
        setTimeout(() => {
          tasks.set(taskId, { id: taskId, runId, sessionKey, status: "succeeded" });
          socket.send(
            JSON.stringify({
              type: "event",
              event: "agent",
              payload: { runId, sessionKey, text: "world", status: "succeeded" },
            })
          );
        }, delayMs * 2);
        return;
      }

      if (method === "sessions.abort" || method === "chat.abort") {
        const runId = params?.runId;
        for (const [tid, task] of tasks.entries()) {
          if (!runId || task.runId === runId) {
            task.status = "cancelled";
            tasks.set(tid, task);
          }
        }
        socket.send(JSON.stringify({ type: "res", id, ok: true, payload: { cancelled: true } }));
        return;
      }

      if (method === "tasks.cancel") {
        const task = tasks.get(params?.taskId);
        if (task) {
          task.status = "cancelled";
          tasks.set(params.taskId, task);
        }
        socket.send(
          JSON.stringify({
            type: "res",
            id,
            ok: true,
            payload: { found: Boolean(task), cancelled: Boolean(task), task },
          })
        );
        return;
      }

      if (method === "tasks.get") {
        const task = tasks.get(params?.taskId) || null;
        socket.send(
          JSON.stringify({
            type: "res",
            id,
            ok: Boolean(task),
            payload: task ? { task } : undefined,
            error: task ? undefined : { code: "not_found", message: "missing" },
          })
        );
        return;
      }

      socket.send(
        JSON.stringify({
          type: "res",
          id,
          ok: false,
          error: { code: "unknown_method", message: method },
        })
      );
    });
  });

  function listen(port = 0) {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        resolve({
          port: address.port,
          url: `ws://127.0.0.1:${address.port}`,
          close: () =>
            new Promise((res) => {
              let done = false;
              const finish = () => {
                if (done) return;
                done = true;
                res();
              };
              for (const client of wss.clients) {
                try {
                  client.terminate();
                } catch {
                  // ignore
                }
              }
              wss.close(() => {
                server.close(finish);
              });
              // Hard fallback if server.close stalls with lingering clients
              setTimeout(finish, 500).unref?.();
            }),
          tasks,
        });
      });
    });
  }

  return { listen, tasks };
}

module.exports = { createMockGateway };

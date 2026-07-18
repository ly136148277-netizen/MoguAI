#!/usr/bin/env node
/**
 * Optional real-Gateway smoke for BETA_SOAK items 1 (connect).
 * Does NOT start Gateway for the user — skips if not already reachable.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildConnectParams, encodeRequest, makeReqId } = require("../src/main/openclaw/protocol");

function health() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:18789/", (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function readToken() {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".openclaw", "openclaw.json"), "utf8")
    );
    return cfg?.gateway?.auth?.token ? String(cfg.gateway.auth.token) : "";
  } catch {
    return "";
  }
}

async function main() {
  if (!(await health())) {
    console.log("[SKIP] Gateway not reachable on 127.0.0.1:18789 — start it yourself, then re-run.");
    process.exit(0);
  }
  const token = readToken();
  if (!token) {
    console.log("[SKIP] No token in ~/.openclaw/openclaw.json");
    process.exit(0);
  }

  const WebSocketImpl = globalThis.WebSocket || require("ws");
  await new Promise((resolve, reject) => {
    const ws = new WebSocketImpl("ws://127.0.0.1:18789");
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error("connect timeout"));
    }, 10000);
    let reqId = null;
    ws.addEventListener("open", () => {
      reqId = makeReqId();
      ws.send(
        encodeRequest(
          "connect",
          buildConnectParams({ token, clientVersion: "1.6.0" }),
          reqId
        )
      );
    });
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type !== "res" || msg.id !== reqId) return;
      clearTimeout(timer);
      if (!msg.ok) {
        reject(new Error(msg.error?.message || "connect failed"));
        return;
      }
      console.log(
        "[PASS] real Gateway hello-ok",
        JSON.stringify({
          protocol: msg.payload?.protocol,
          version: msg.payload?.server?.version,
          client: "gateway-client/backend",
        })
      );
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("ws error"));
    });
  });
}

main().catch((error) => {
  console.error("[FAIL]", error.message);
  process.exit(1);
});

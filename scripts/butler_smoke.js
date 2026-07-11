#!/usr/bin/env node
/**
 * Butler smoke: PAI HTTP + preset command alignment with pai-catalog.js
 * Usage: node scripts/butler_smoke.js [--api http://127.0.0.1:8765] [--integration]
 */

const http = require("node:http");
const https = require("node:https");
const { PRESET_COMMANDS } = require("../src/shared/pai-catalog");

const argv = process.argv.slice(2);
const apiUrl = (argv.find((arg, i) => argv[i - 1] === "--api") || "http://127.0.0.1:8765").replace(/\/$/, "");
const withIntegration = argv.includes("--integration");
const paiRoot = (argv.find((arg, i) => argv[i - 1] === "--pai-root") || "E:\\projects\\PAI").replace(/\/$/, "");

function getJson(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, apiUrl);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.get(url, { timeout: 60_000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`invalid json from ${path}: ${error.message}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout ${path}`));
    });
  });
}

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, apiUrl);
    const payload = JSON.stringify(body);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      { method: "POST", timeout: 60_000, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (error) {
            reject(new Error(`invalid json from POST ${path}: ${error.message}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout POST ${path}`));
    });
    req.write(payload);
    req.end();
  });
}

async function runIntegration() {
  const { PaiBridge } = require("../src/main/pai-bridge");
  const { getComfyUiStatus, getProgressSnapshot } = require("../src/main/comfyui-bridge");
  const { assess, assessPaiResponse } = require("../src/shared/butler-risk");
  const settings = { paiApiUrl: apiUrl, paiRoot, paiDefaultLevel: 1 };
  const bridge = new PaiBridge();

  if (!(await bridge.ping(settings))) throw new Error("PAI ping failed");
  console.log("[ok] integration pai ping");

  const status = await getComfyUiStatus(paiRoot);
  if (!status.running) throw new Error(`ComfyUI offline: ${status.error || "unknown"}`);
  console.log(`[ok] integration comfyui running @ ${status.api}`);

  const snap = await getProgressSnapshot(paiRoot);
  console.log(`[ok] integration comfyui phase=${snap.phase}`);

  const cmd = PRESET_COMMANDS.zimage;
  const risk = assess(cmd, 1);
  if (!risk.needsConfirm || risk.requiredLevel !== 2) {
    throw new Error(`butler L2 gate failed for ${cmd}`);
  }
  console.log("[ok] integration butler L2 gate");

  const blocked = await bridge.run(settings, cmd, 1);
  const paiRisk = assessPaiResponse(cmd, blocked);
  if (!blocked.needs_confirm || !paiRisk?.needsConfirm) {
    throw new Error("PAI needs_confirm gate failed for L1 zimage");
  }
  console.log("[ok] integration PAI needs_confirm gate");

  const queue = await bridge.run(settings, "comfyui queue", 2);
  if (!queue.ok) throw new Error(`comfyui queue run failed: ${queue.error || queue.message}`);
  console.log(`[ok] integration POST /run queue (${queue.message})`);
}

async function main() {
  const health = await getJson("/health");
  if (!health.ok) throw new Error("/health not ok");
  console.log("[ok] /health");

  const capabilities = await getJson("/capabilities");
  if (!capabilities.ok) throw new Error("/capabilities not ok");
  const names = (capabilities.capabilities || []).map((row) => row.name);
  for (const need of ["launch_app", "video_factory", "comfyui_manage"]) {
    if (!names.includes(need)) throw new Error(`missing capability: ${need}`);
  }
  console.log(`[ok] /capabilities (${capabilities.count})`);

  const catalog = await getJson("/workflows/catalog");
  if (!catalog.ok) throw new Error("/workflows/catalog not ok");
  console.log(`[ok] /workflows/catalog count=${catalog.count}`);

  const presets = await getJson("/workflows/presets");
  if (!presets.ok) throw new Error("/workflows/presets not ok");
  if (presets.count !== 5) throw new Error(`expected 5 presets, got ${presets.count}`);
  for (const preset of presets.presets || []) {
    const want = PRESET_COMMANDS[preset.id];
    if (!want) throw new Error(`unexpected preset id: ${preset.id}`);
    if (preset.command !== want) {
      throw new Error(`preset ${preset.id} command mismatch: got '${preset.command}', want '${want}'`);
    }
  }
  console.log("[ok] /workflows/presets (5 commands aligned)");

  if (withIntegration) {
    await runIntegration();
  }

  console.log("");
  console.log(`Butler smoke passed${withIntegration ? " (with integration)" : ""}.`);
}

main().catch((error) => {
  console.error("");
  console.error(`Butler smoke FAILED: ${error.message}`);
  console.error("Hint: restart pai serve after pulling PAI gateway changes.");
  process.exit(1);
});

#!/usr/bin/env node
"use strict";

/**
 * Lightweight 2.4 security audit: secrets never in settings defaults / control-plane public snaps.
 */
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_SETTINGS } = require("../src/main/settings");
const { createControlPlane } = require("../src/main/control-plane");

const ROOT = path.join(__dirname, "..");
const out = [];
let failed = 0;

function check(id, ok, detail = "") {
  out.push({ id, ok: Boolean(ok), detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

async function main() {
  check("settings.agentApiKey.empty", DEFAULT_SETTINGS.agentApiKey === "");
  check("remote.defaultOff", DEFAULT_SETTINGS.remote.enabled === false);
  check("controlPlane.defaultOff", DEFAULT_SETTINGS.controlPlaneEnabled === false);

  const settingsPath = path.join(ROOT, "src", "main", "settings.js");
  const settingsSrc = fs.readFileSync(settingsPath, "utf8");
  check("no-env-secret-pattern", !/process\.env\.(OPENAI_API_KEY|TELEGRAM)/.test(settingsSrc));

  const plane = createControlPlane({
    getSettings: async () => ({
      ...DEFAULT_SETTINGS,
      controlPlaneEnabled: true,
      agentBrainChannel: "api",
      agentApiBaseUrl: "http://127.0.0.1:11434/v1",
      agentApiModel: "qwen2.5-coder:7b",
    }),
    updateSettings: async (p) => p,
    secretStore: {
      async has() {
        return true;
      },
      async set() {
        return { ok: true };
      },
      async delete() {
        return { ok: true };
      },
    },
    getSetupStatus: async () => ({
      ollama: { installed: true, running: true },
      pai: { installed: true, running: true },
      comfyui: { found: false, running: false },
      ffmpeg: { installed: true },
    }),
    listOllamaModels: async () => ({ models: [] }),
    getOpenclawStatus: async () => ({}),
    getRemoteStatus: async () => ({ running: false, channels: [] }),
    probeCoding: async () => ({ ok: true }),
    probeDocker: async () => ({ state: "Missing", required: false }),
    testBrain: async () => ({ ok: true }),
  });

  const snap = await plane.status();
  const raw = JSON.stringify(snap);
  check("snapshot.no-raw-key", !/sk-[a-zA-Z0-9]{10,}/.test(raw));
  check("snapshot.internalsHidden", snap.internalsHidden === true);
  check("snapshot.endpoint-not-port", !raw.includes(":11434") && !raw.includes("8765"));

  const remote = await plane.remote.status();
  check("remote.secretStoreOnly", remote.secretStoreOnly === true);

  const report = {
    kind: "mogu-v2.4-security-audit",
    status: failed === 0 ? "PASS" : "FAIL",
    failed,
    checks: out,
    completedAt: new Date().toISOString(),
  };
  const dir = path.join(ROOT, "benchmarks", "v2.4", "results");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "security-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nMOGU 2.4 security audit: ${failed === 0 ? "PASS" : "FAIL"}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

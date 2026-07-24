#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_SETTINGS } = require("../src/main/settings");
const { createControlPlane } = require("../src/main/control-plane");

const ROOT = path.join(__dirname, "..");
const RESULT_DIR = path.join(ROOT, "benchmarks", "v2.4", "results");
const checks = [];

function check(id, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push({ id, ok, detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id}${detail ? ` — ${detail}` : ""}`);
}

function hasFile(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function createPlane(overrides = {}) {
  let settings = {
    ...DEFAULT_SETTINGS,
    controlPlaneEnabled: true,
    agentBrainChannel: "builtin",
    ...overrides.settings,
  };
  const secrets = new Map(Object.entries(overrides.secrets || {}));
  const plane = createControlPlane({
    getSettings: async () => settings,
    updateSettings: async (partial) => {
      settings = { ...settings, ...partial };
      return settings;
    },
    secretStore: {
      async set(k, v) {
        secrets.set(k, v);
        return { ok: true };
      },
      async delete(k) {
        secrets.delete(k);
        return { ok: true };
      },
      async has(k) {
        return secrets.has(k) && Boolean(secrets.get(k));
      },
    },
    getSetupStatus: async () =>
      overrides.setup || {
        ollama: { installed: true, running: true },
        pai: { installed: false, running: false },
        comfyui: { found: false, running: false },
        ffmpeg: { installed: false },
        ready: {},
      },
    listOllamaModels: async () => ({ models: [{ name: "qwen2.5-coder:7b" }] }),
    getOpenclawStatus: async () => ({ connected: false }),
    getRemoteStatus: async () => ({ running: false, channels: [] }),
    probeCoding: async () => ({ ok: true }),
    probeDocker: async () => ({ id: "docker", title: "容器工具", state: "Missing", required: false }),
    testBrain: async () => ({ ok: true, message: "ok" }),
  });
  return { plane, getSettings: () => settings, secrets };
}

async function main() {
  for (const rel of [
    "src/main/control-plane/index.js",
    "src/main/control-plane/CapabilityRegistry.js",
    "src/main/control-plane/BrainManager.js",
    "src/main/control-plane/CapabilityDiscovery.js",
    "src/main/control-plane/DependencySupervisor.js",
    "src/main/control-plane/RemoteCenter.js",
    "src/main/control-plane/FirstRunWizard.js",
    "docs/V2.4_DECISION_PACKAGE.md",
    "src/renderer/control-plane-panel.js",
  ]) {
    check(`file:${rel}`, hasFile(rel));
  }

  check("default-off:controlPlaneEnabled", DEFAULT_SETTINGS.controlPlaneEnabled === false);
  check("default-off:autoStartServices", DEFAULT_SETTINGS.autoStartServices === false);
  check("default-off:autoInstallRuntime", DEFAULT_SETTINGS.autoInstallRuntime === false);
  check("default-off:modelFallback", DEFAULT_SETTINGS.modelFallback === false);
  check("default-off:backgroundSupervisor", DEFAULT_SETTINGS.backgroundSupervisor === false);
  check("default-off:remote", DEFAULT_SETTINGS.remote.enabled === false);

  // 1) first-run wizard
  {
    const { plane } = createPlane({ settings: { controlPlaneEnabled: false, showSetupWizard: true } });
    const wiz = await plane.wizard.status();
    check("wizard:status", wiz.ok === true && wiz.showWizard === true);
    const choose = await plane.wizard.chooseAi({ choice: "local" });
    check("wizard:choose-local", choose.ok === true && choose.payload.channel === "local");
  }

  // 2) select Ollama + 3) chat readiness path
  {
    const { plane, getSettings } = createPlane();
    const setLocal = await plane.brain.set({
      channel: "local",
      localModel: "qwen2.5-coder:7b",
      test: true,
    });
    check("brain:ollama-set", setLocal.ok === true && setLocal.immediate === true);
    check("brain:ollama-no-restart", setLocal.restartRequired === false);
    check("brain:ollama-applied", getSettings().agentBrainChannel === "local");
    check("brain:ollama-model", getSettings().agentLocalModel === "qwen2.5-coder:7b");
  }

  // 4-5) switch OpenAI provider immediate
  {
    const { plane, getSettings, secrets } = createPlane();
    const setApi = await plane.brain.set({
      channel: "api",
      apiBaseUrl: "https://api.openai.com/v1",
      apiModel: "gpt-4o-mini",
      apiKey: "sk-acceptance",
      test: true,
    });
    check("brain:openai-set", setApi.ok === true && getSettings().agentApiModel === "gpt-4o-mini");
    check("brain:openai-immediate", setApi.immediate === true && setApi.restartRequired === false);
    check("secret:api-key-store", secrets.get("agentApiKey") === "sk-acceptance");
    check("secret:not-in-settings", !getSettings().agentApiKey);
  }

  // 6) Telegram config surface
  {
    const { plane, secrets } = createPlane({
      settings: {
        controlPlaneEnabled: true,
        remote: {
          enabled: true,
          telegram: { enabled: true },
          qq: { enabled: false },
          wechat: { enabled: false },
          requireApproval: true,
          allowAutoExecute: false,
        },
        remoteOwner: { telegramUserId: "111", qqUserId: "", wechatUserId: "" },
      },
    });
    const token = await plane.remote.setTelegramToken("123456:ABC-DEF");
    check("remote:token-secret", token.ok === true && secrets.has("telegramBotToken"));
    const status = await plane.remote.status();
    check("remote:status", status.ok === true && status.channels.telegram.tokenConfigured === true);
    check("remote:owner", status.channels.telegram.owner === "111");
  }

  // 7-8) error / missing dependency hints
  {
    const { plane } = createPlane({
      setup: {
        ollama: { installed: false, running: false },
        pai: { installed: false, running: false },
        comfyui: { found: false, running: false },
        ffmpeg: { installed: false },
      },
    });
    const deps = await plane.supervisor.check({ text: "帮我生成视频" });
    check("deps:video-blocked", deps.blocked === true);
    check(
      "deps:comfy-hint",
      deps.missing.some((m) => m.id === "comfyui" && m.actions.some((a) => a.label === "安装"))
    );
    const discovery = await plane.discovery.discover();
    check("discover:not-ready-or-ready", discovery.ok === true && typeof discovery.status === "string");
    check(
      "discover:no-ports",
      !JSON.stringify(discovery).includes(":11434") && !JSON.stringify(discovery).includes("8765")
    );
  }

  // 9) SecretStore check API shape via remote center
  {
    const { plane } = createPlane();
    await plane.remote.setTelegramToken("1:token");
    const st = await plane.remote.status();
    check("secret:store-only-flag", st.secretStoreOnly === true);
  }

  // 10) Default-Off facade when disabled
  {
    const { plane } = createPlane({ settings: { controlPlaneEnabled: false } });
    const status = await plane.status();
    check("gate:disabled", status.overall === "DISABLED");
  }

  const passed = checks.filter((c) => c.ok).length;
  const report = {
    schemaVersion: 1,
    kind: "mogu-v2.4-acceptance",
    status: passed === checks.length ? "PASS" : "FAIL",
    passed,
    total: checks.length,
    checks,
    completedAt: new Date().toISOString(),
  };
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULT_DIR, "acceptance.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nMOGU 2.4 acceptance: ${passed}/${checks.length} passed`);
  process.exit(report.status === "PASS" ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

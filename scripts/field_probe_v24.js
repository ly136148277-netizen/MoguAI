#!/usr/bin/env node
/**
 * Desktop field probe for MOGU 2.4 Control Plane (no new product features).
 * Runs inside Electron so SecretStore/safeStorage work. Never prints secrets.
 */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { app } = require("electron");

const ROOT = path.join(__dirname, "..");
const USER_DATA =
  process.env.MOGU_USER_DATA ||
  path.join(process.env.APPDATA || "", "ai-model-manager");

app.setPath("userData", USER_DATA);

function redact(value) {
  const text = JSON.stringify(value);
  return {
    hasSk: /sk-[a-zA-Z0-9]{8,}/i.test(text),
    hasTokenish: /bot\d+:[A-Za-z0-9_-]{20,}/.test(text),
    hasPort11434: text.includes(":11434"),
    hasPort8765: text.includes(":8765"),
    hasDriveE: /E:\\\\Project|E:\/Project/i.test(text),
  };
}

app.whenReady().then(async () => {
  const report = {
    ok: false,
    userData: USER_DATA,
    secretValuePrinted: false,
    checks: [],
  };
  const check = (id, ok, detail = "") => {
    report.checks.push({ id, ok: Boolean(ok), detail: String(detail || "") });
  };

  try {
    const { SecretStore } = require(path.join(ROOT, "src", "main", "secret-store"));
    const { SettingsStore, DEFAULT_SETTINGS } = require(path.join(ROOT, "src", "main", "settings"));
    const { createControlPlane } = require(path.join(ROOT, "src", "main", "control-plane"));
    const { getSetupStatus } = require(path.join(ROOT, "src", "main", "setup-hub"));
    const { OllamaService } = require(path.join(ROOT, "src", "main", "ollama"));
    const settingsStore = new SettingsStore(path.join(USER_DATA, "settings.json"));
    const secretStore = new SecretStore(path.join(USER_DATA, "secrets.json"));
    const settings = await settingsStore.load();

    check("defaults.controlPlaneOffInCode", DEFAULT_SETTINGS.controlPlaneEnabled === false);
    check("field.controlPlaneEnabled", settings.controlPlaneEnabled === true, "must be enabled for soak");
    check("settings.apiKeyEmpty", settings.agentApiKey === "");
    check("settings.noPaiRootPersonal", !/E:\\\\Project|E:\/Project/i.test(String(settings.paiRoot || "")));

    const ollama = new OllamaService();
    const plane = createControlPlane({
      getSettings: () => settingsStore.load(),
      updateSettings: (partial) => settingsStore.update(partial),
      secretStore,
      getSetupStatus: async () =>
        getSetupStatus({
          paiBridge: {
            resolvePaiRoot: (s) => s.paiRoot || "",
            getStatus: async () => ({ installed: false, running: false }),
          },
          ollamaService: ollama,
          settings: await settingsStore.load(),
          userDataPath: USER_DATA,
          logger: null,
        }),
      listOllamaModels: async () => {
        try {
          if (ollama?.listModels) {
            const listed = await ollama.listModels();
            if (listed?.models?.length || Array.isArray(listed)) return listed;
          }
        } catch {
          /* fall through */
        }
        try {
          const res = await fetch("http://127.0.0.1:11434/api/tags");
          const json = await res.json();
          return { models: json.models || [] };
        } catch (error) {
          return { models: [], error: error.message };
        }
      },
      getOpenclawStatus: async () => ({ connected: false }),
      getRemoteStatus: async () => ({ running: false, channels: [] }),
      probeCoding: async () => ({ ok: true }),
      testBrain: async () => ({ ok: true, message: "probe-skip-live" }),
    });

    const status = await plane.status();
    check("status.enabled", status.controlPlaneEnabled === true || status.overall !== "DISABLED");
    check("status.internalsHidden", status.internalsHidden === true);
    const leaks = redact(status);
    check("status.noRawKey", !leaks.hasSk && !leaks.hasTokenish);
    check("status.noPorts", !leaks.hasPort11434 && !leaks.hasPort8765);
    check("status.noDriveE", !leaks.hasDriveE);

    const discovery = await plane.discovery.discover();
    check("discover.ok", discovery.ok === true);
    check("discover.hasChecklist", Array.isArray(discovery.checklist) && discovery.checklist.length >= 5);
    const dLeaks = redact(discovery);
    check("discover.noPorts", !dLeaks.hasPort11434 && !dLeaks.hasPort8765);

    const models = await plane.brain.listLocalModels();
    const names = (models.models || []).map((m) => m.name);
    check(
      "brain.localModelsVisible",
      names.some((n) => String(n).includes("qwen2.5-coder")),
      names.slice(0, 8).join(",")
    );

    const before = await plane.brain.get();
    const toLocal = await plane.brain.set({
      channel: "local",
      localModel: "qwen2.5-coder:7b",
      test: false,
    });
    check("brain.switchLocal", toLocal.ok === true && toLocal.restartRequired === false);
    const afterLocal = await settingsStore.load();
    check("brain.localImmediate", afterLocal.agentBrainChannel === "local");

    const toApi = await plane.brain.set({
      channel: "api",
      apiPreset: "custom",
      apiBaseUrl: "http://127.0.0.1:11434/v1",
      apiModel: "qwen2.5-coder:7b",
      test: false,
    });
    check("brain.switchApiCompat", toApi.ok === true && toApi.immediate === true);
    const afterApi = await settingsStore.load();
    check("brain.apiImmediate", afterApi.agentBrainChannel === "api");
    check("brain.apiKeyStillEmptyInSettings", afterApi.agentApiKey === "");

    // restore prior channel preference if it was api ollama
    if (before.channel === "api") {
      await plane.brain.set({
        channel: "api",
        apiPreset: before.apiPreset || "custom",
        apiBaseUrl: before.apiBaseUrl || "http://127.0.0.1:11434/v1",
        apiModel: before.apiModel || "qwen2.5-coder:7b",
        test: false,
      });
    }

    const deps = await plane.supervisor.check({ text: "帮我生成视频" });
    check("deps.videoHint", deps.ok === true || deps.blocked === true);

    const remote = await plane.remote.status();
    check("remote.secretStoreOnly", remote.secretStoreOnly === true);
    const tgToken = await secretStore.has("telegramBotToken");
    const agentKey = await secretStore.has("agentApiKey");
    check("secret.telegramPresentOrAbsent", typeof tgToken === "boolean", `telegram=${tgToken}`);
    check("secret.agentKeyPresentOrAbsent", typeof agentKey === "boolean", `agentApiKey=${agentKey}`);

    const settingsDisk = JSON.parse(fs.readFileSync(path.join(USER_DATA, "settings.json"), "utf8"));
    check("disk.settingsNoApiKey", !settingsDisk.agentApiKey);
    check("disk.settingsNoTelegramToken", !JSON.stringify(settingsDisk).includes("telegramBotToken"));

    report.ok = report.checks.every((c) => c.ok);
    report.summary = {
      overall: status.overall || status.message,
      brainChannel: afterApi.agentBrainChannel,
      model: afterApi.agentApiModel || afterApi.agentLocalModel,
      discoveryStatus: discovery.status,
      remoteEnabled: settingsDisk.remote?.enabled === true,
      controlPlaneEnabled: settingsDisk.controlPlaneEnabled === true,
    };
  } catch (error) {
    report.error = error.message;
    check("probe.exception", false, error.message);
    report.ok = false;
  }

  const outDir = path.join(ROOT, "benchmarks", "v2.4", "results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "field-probe.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: report.ok, passed: report.checks.filter((c) => c.ok).length, total: report.checks.length, summary: report.summary || null, secretValuePrinted: false }, null, 2));
  app.exit(report.ok ? 0 : 1);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_SETTINGS } = require("../src/main/settings");
const {
  createControlPlane,
  BrainManager,
  DependencySupervisor,
  CapabilityRegistry,
} = require("../src/main/control-plane");

test("2.4 control plane flags default off", () => {
  assert.equal(DEFAULT_SETTINGS.controlPlaneEnabled, false);
  assert.equal(DEFAULT_SETTINGS.autoStartServices, false);
  assert.equal(DEFAULT_SETTINGS.autoInstallRuntime, false);
  assert.equal(DEFAULT_SETTINGS.modelFallback, false);
  assert.equal(DEFAULT_SETTINGS.backgroundSupervisor, false);
  assert.equal(DEFAULT_SETTINGS.remote.enabled, false);
});

test("BrainManager switches channel immediately without restart flag", async () => {
  let settings = {
    agentBrainChannel: "builtin",
    agentLocalModel: "",
    agentApiBaseUrl: "",
    agentApiModel: "",
    agentApiPreset: "custom",
  };
  const secrets = new Map();
  const mgr = new BrainManager({
    getSettings: async () => settings,
    updateSettings: async (partial) => {
      settings = { ...settings, ...partial };
      return settings;
    },
    secretStore: {
      async set(key, value) {
        secrets.set(key, value);
        return { ok: true };
      },
      async delete(key) {
        secrets.delete(key);
        return { ok: true };
      },
      async has(key) {
        return secrets.has(key);
      },
    },
    testBrain: async () => ({ ok: true, message: "ok" }),
    listOllamaModels: async () => ({ models: [{ name: "qwen2.5-coder:7b" }] }),
  });

  const local = await mgr.set({ channel: "local", localModel: "qwen2.5-coder:7b", test: true });
  assert.equal(local.ok, true);
  assert.equal(local.restartRequired, false);
  assert.equal(local.immediate, true);
  assert.equal(settings.agentBrainChannel, "local");
  assert.equal(settings.agentLocalModel, "qwen2.5-coder:7b");

  const cloud = await mgr.set({
    channel: "api",
    apiBaseUrl: "https://api.openai.com/v1",
    apiModel: "gpt-4o-mini",
    apiKey: "sk-test",
    test: true,
  });
  assert.equal(cloud.ok, true);
  assert.equal(settings.agentBrainChannel, "api");
  assert.equal(settings.agentApiModel, "gpt-4o-mini");
  assert.equal(secrets.get("agentApiKey"), "sk-test");
  assert.equal(Object.prototype.hasOwnProperty.call(settings, "agentApiKey") && settings.agentApiKey, false);
});

test("DependencySupervisor blocks video intent when Comfy missing", async () => {
  const registry = {
    async snapshot() {
      return {
        runtime: { pai: { id: "pai", title: "管家服务", state: "Healthy" } },
        skills: {
          comfyui: { id: "comfyui", title: "图像创作", state: "Missing", reason: "未配置", fix: "安装" },
          media: { id: "ffmpeg", title: "视频工具", state: "Healthy" },
          coding: { id: "coding", title: "编程", state: "Healthy" },
        },
      };
    },
  };
  const supervisor = new DependencySupervisor({
    registry,
    getSettings: async () => ({
      autoStartServices: false,
      autoInstallRuntime: false,
      agentBrainChannel: "api",
    }),
  });
  const result = await supervisor.check({ text: "帮我生成视频" });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.ok(result.missing.some((m) => m.id === "comfyui"));
  assert.ok(result.missing[0].actions.some((a) => a.id === "install"));
});

test("CapabilityRegistry snapshot hides internals and respects Default-Off gate via facade", async () => {
  let settings = { ...DEFAULT_SETTINGS, controlPlaneEnabled: false, agentBrainChannel: "builtin" };
  const plane = createControlPlane({
    getSettings: async () => settings,
    updateSettings: async (p) => {
      settings = { ...settings, ...p };
      return settings;
    },
    secretStore: { async has() { return false; }, async set() { return { ok: true }; }, async delete() { return { ok: true }; } },
    getSetupStatus: async () => ({
      ollama: { installed: true, running: true },
      pai: { installed: true, running: true },
      comfyui: { found: true, running: true },
      ffmpeg: { installed: true },
      ready: {},
    }),
    listOllamaModels: async () => ({ models: [{ name: "qwen2.5-coder:7b" }] }),
    getOpenclawStatus: async () => ({ connected: false }),
    getRemoteStatus: async () => ({ running: false, channels: [] }),
    probeCoding: async () => ({ ok: true }),
    probeDocker: async () => ({ id: "docker", title: "容器工具", state: "Missing", required: false }),
    testBrain: async () => ({ ok: true }),
  });

  const disabled = await plane.status();
  assert.equal(disabled.controlPlaneEnabled, false);
  assert.equal(disabled.overall, "DISABLED");

  settings.controlPlaneEnabled = true;
  settings.agentBrainChannel = "local";
  settings.agentLocalModel = "qwen2.5-coder:7b";
  const snap = await plane.status();
  assert.equal(snap.ok, true);
  assert.equal(snap.internalsHidden, true);
  assert.equal(snap.brain.model, "qwen2.5-coder:7b");
  assert.ok(!JSON.stringify(snap).includes("127.0.0.1"));
  assert.ok(!JSON.stringify(snap).includes(":11434"));
});

test("wizard chooseAi returns brain-set payloads", async () => {
  const plane = createControlPlane({
    getSettings: async () => ({ ...DEFAULT_SETTINGS }),
    updateSettings: async () => ({}),
    secretStore: { async has() { return false; }, async set() { return { ok: true }; }, async delete() { return { ok: true }; } },
    getSetupStatus: async () => ({ ollama: {}, pai: {}, comfyui: {}, ffmpeg: {} }),
    testBrain: async () => ({ ok: true }),
  });
  const local = await plane.wizard.chooseAi({ choice: "local" });
  assert.equal(local.ok, true);
  assert.equal(local.payload.channel, "local");
  const openai = await plane.wizard.chooseAi({ choice: "openai" });
  assert.equal(openai.payload.channel, "api");
});

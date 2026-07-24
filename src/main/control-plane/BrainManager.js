"use strict";

/**
 * BrainManager — switch current Brain without restarting Electron.
 * Keys go to SecretStore only.
 */
class BrainManager {
  /**
   * @param {{
   *   getSettings: () => Promise<object>,
   *   updateSettings: (partial: object) => Promise<object>,
   *   secretStore: { set: Function, delete: Function, has?: Function },
   *   testBrain: (settings: object) => Promise<object>,
   *   listOllamaModels?: () => Promise<any>,
   * }} deps
   */
  constructor(deps = {}) {
    this.deps = deps;
  }

  async get() {
    const settings = await this.deps.getSettings();
    const keyConfigured = await this._hasSecret("agentApiKey");
    return {
      ok: true,
      channel: settings.agentBrainChannel || "builtin",
      localModel: settings.agentLocalModel || "",
      apiPreset: settings.agentApiPreset || "",
      apiBaseUrl: settings.agentApiBaseUrl || "",
      apiModel: settings.agentApiModel || "",
      agentApiKeyConfigured: keyConfigured,
      // Never return secret values.
      endpointKind:
        settings.agentBrainChannel === "local"
          ? "local"
          : settings.agentBrainChannel === "api"
            ? "cloud"
            : "builtin",
    };
  }

  /**
   * @param {{
   *   channel: 'local'|'api'|'builtin',
   *   localModel?: string,
   *   apiPreset?: string,
   *   apiBaseUrl?: string,
   *   apiModel?: string,
   *   apiKey?: string,
   *   clearApiKey?: boolean,
   *   test?: boolean,
   * }} input
   */
  async set(input = {}) {
    const channel = String(input.channel || "").trim().toLowerCase();
    if (!["local", "api", "builtin"].includes(channel)) {
      return { ok: false, error: "无效的 AI 来源" };
    }

    const patch = { agentBrainChannel: channel };

    if (channel === "local") {
      const model = String(input.localModel || "").trim();
      if (!model) return { ok: false, error: "请选择本地模型" };
      patch.agentLocalModel = model;
    }

    if (channel === "api") {
      const baseUrl = String(input.apiBaseUrl || "").trim();
      const model = String(input.apiModel || "").trim();
      if (!baseUrl) return { ok: false, error: "请填写服务地址" };
      if (!model) return { ok: false, error: "请填写模型名" };
      patch.agentApiBaseUrl = baseUrl.replace(/\/+$/, "");
      patch.agentApiModel = model;
      if (input.apiPreset) patch.agentApiPreset = String(input.apiPreset).trim();

      const key = String(input.apiKey || "").trim();
      if (key) {
        const saved = await this.deps.secretStore.set("agentApiKey", key);
        if (!saved?.ok) return { ok: false, error: saved?.error || "无法安全保存密钥" };
      } else if (input.clearApiKey === true) {
        await this.deps.secretStore.delete("agentApiKey");
      }
    }

    await this.deps.updateSettings(patch);
    const current = await this.get();

    let test = null;
    if (input.test !== false && channel !== "builtin") {
      const settings = await this.deps.getSettings();
      try {
        test = await this.deps.testBrain(settings);
      } catch (error) {
        test = { ok: false, error: error.message };
      }
    }

    return {
      ok: true,
      applied: true,
      immediate: true,
      restartRequired: false,
      brain: current,
      test,
    };
  }

  async listLocalModels() {
    if (typeof this.deps.listOllamaModels !== "function") {
      return { ok: true, models: [] };
    }
    try {
      const listed = await this.deps.listOllamaModels();
      const models = Array.isArray(listed?.models)
        ? listed.models
        : Array.isArray(listed)
          ? listed
          : [];
      return {
        ok: true,
        models: models.map((m) => ({
          name: m.name || m.model || String(m),
          size: m.size || null,
        })),
      };
    } catch (error) {
      return { ok: false, error: error.message, models: [] };
    }
  }

  async _hasSecret(id) {
    try {
      if (typeof this.deps.secretStore?.has === "function") {
        return Boolean(await this.deps.secretStore.has(id));
      }
    } catch {
      /* ignore */
    }
    return false;
  }
}

module.exports = { BrainManager };

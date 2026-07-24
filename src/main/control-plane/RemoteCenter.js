"use strict";

/**
 * Remote Center — status surface over RemoteManager + SecretStore.
 * Never reads/writes tokens into settings.json.
 */
class RemoteCenter {
  /**
   * @param {{
   *   getSettings: () => Promise<object>,
   *   secretStore: { has?: Function, set?: Function, delete?: Function },
   *   getRemoteStatus?: () => Promise<object>,
   *   startRemote?: () => Promise<object>,
   *   stopRemote?: () => Promise<object>,
   * }} deps
   */
  constructor(deps = {}) {
    this.deps = deps;
  }

  async status() {
    const settings = await this.deps.getSettings();
    const remote = settings.remote || {};
    const owner = settings.remoteOwner || {};
    const live = (await this.deps.getRemoteStatus?.()) || {};
    const telegramToken = await this._has("telegramBotToken");

    return {
      ok: true,
      enabled: remote.enabled === true,
      running: live.running === true,
      channels: {
        telegram: {
          enabled: remote.telegram?.enabled === true || remote.telegram === true,
          owner: owner.telegramUserId || "",
          tokenConfigured: telegramToken,
          connected: live.running === true && (live.channels || []).includes("telegram"),
          permission: remote.requireApproval !== false ? "L1+确认" : "宽松",
        },
        qq: {
          enabled: remote.qq?.enabled === true || remote.qq === true,
          owner: owner.qqUserId || "",
          tokenConfigured: false,
          connected: false,
          permission: remote.requireApproval !== false ? "L1+确认" : "宽松",
        },
        wechat: {
          enabled: remote.wechat?.enabled === true || remote.wechat === true,
          owner: owner.wechatUserId || "",
          tokenConfigured: false,
          connected: false,
          permission: remote.requireApproval !== false ? "L1+确认" : "宽松",
        },
      },
      secretStoreOnly: true,
    };
  }

  async setTelegramToken(token) {
    const value = String(token || "").trim();
    if (!value) {
      await this.deps.secretStore.delete?.("telegramBotToken");
      return { ok: true, cleared: true, tokenConfigured: false };
    }
    if (!value.includes(":")) {
      return { ok: false, error: "Token 格式无效" };
    }
    const saved = await this.deps.secretStore.set("telegramBotToken", value);
    if (!saved?.ok) return { ok: false, error: saved?.error || "无法安全保存" };
    return { ok: true, tokenConfigured: true, secretValuePrinted: false };
  }

  async _has(key) {
    try {
      return Boolean(await this.deps.secretStore?.has?.(key));
    } catch {
      return false;
    }
  }
}

module.exports = { RemoteCenter };

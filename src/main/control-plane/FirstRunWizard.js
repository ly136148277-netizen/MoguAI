"use strict";

/**
 * First-run wizard state — intent-first, not "did you install X?".
 */
class FirstRunWizard {
  constructor({ getSettings, updateSettings } = {}) {
    this.getSettings = getSettings;
    this.updateSettings = updateSettings;
  }

  async status() {
    const settings = await this.getSettings();
    return {
      ok: true,
      showWizard: settings.showSetupWizard !== false,
      showWelcomeCard: settings.showWelcomeCard !== false,
      controlPlaneEnabled: settings.controlPlaneEnabled === true,
      steps: [
        { id: "detect", title: "检测环境" },
        { id: "choose-ai", title: "选择 AI 来源", choices: ["local", "openai", "other"] },
        { id: "verify", title: "连通检测" },
        { id: "first-task", title: "完成第一条任务" },
      ],
    };
  }

  /**
   * @param {{ choice: 'local'|'openai'|'other', localModel?: string, apiBaseUrl?: string, apiModel?: string }} input
   */
  async chooseAi(input = {}) {
    const choice = String(input.choice || "").trim().toLowerCase();
    if (choice === "local") {
      return {
        ok: true,
        next: "brain-set",
        payload: {
          channel: "local",
          localModel: input.localModel || "qwen2.5-coder:7b",
        },
        hint: "将使用本机模型。若尚未安装本地模型服务，请按提示安装或改选云端。",
      };
    }
    if (choice === "openai" || choice === "other") {
      return {
        ok: true,
        next: "brain-set",
        payload: {
          channel: "api",
          apiPreset: choice === "openai" ? "openai" : "custom",
          apiBaseUrl: input.apiBaseUrl || (choice === "openai" ? "https://api.openai.com/v1" : ""),
          apiModel: input.apiModel || (choice === "openai" ? "gpt-4o-mini" : ""),
        },
        hint: "请保存 API Key（加密存储），然后测试连接。",
      };
    }
    return { ok: false, error: "请选择本地模型、OpenAI 或其它服务" };
  }

  async complete() {
    await this.updateSettings({
      showSetupWizard: false,
      showWelcomeCard: false,
      controlPlaneEnabled: true,
    });
    return { ok: true, completed: true };
  }
}

module.exports = { FirstRunWizard };

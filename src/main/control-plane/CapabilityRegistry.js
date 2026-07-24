"use strict";

const { normalizeState, publicLabel, isReadyState } = require("./CapabilityTypes");

/**
 * CapabilityRegistry — thin aggregator over existing adapters / preflight / SecretStore.
 * Does NOT reinvent detection.
 */
class CapabilityRegistry {
  /**
   * @param {{
   *   getSettings: () => Promise<object>,
   *   secretStore: { has?: Function, hasReference?: Function },
   *   getSetupStatus: () => Promise<object>,
   *   listOllamaModels?: () => Promise<any>,
   *   getOpenclawStatus?: () => Promise<object>,
   *   getRemoteStatus?: () => Promise<object>,
   *   probeCoding?: () => Promise<object>,
   *   probeDocker?: () => Promise<object>,
   *   testBrain?: () => Promise<object>,
   * }} deps
   */
  constructor(deps = {}) {
    this.deps = deps;
  }

  async snapshot() {
    const settings = await this.deps.getSettings();
    const controlPlaneEnabled = settings.controlPlaneEnabled === true;

    const setup = await this.deps.getSetupStatus().catch((error) => ({
      ok: false,
      error: error.message,
      ollama: {},
      pai: {},
      comfyui: {},
      ffmpeg: {},
      ready: {},
    }));

    const [models, openclaw, remote, coding, docker, agentKey, telegramToken] = await Promise.all([
      this._safe(() => this.deps.listOllamaModels?.()),
      this._safe(() => this.deps.getOpenclawStatus?.()),
      this._safe(() => this.deps.getRemoteStatus?.()),
      this._safe(() => this.deps.probeCoding?.()),
      this._safe(() => this.deps.probeDocker?.()),
      this._secretHas("agentApiKey"),
      this._secretHas("telegramBotToken"),
    ]);

    const brain = this._brainBlock(settings, agentKey, setup.ollama, models);
    const runtime = {
      openclaw: this._openclawBlock(settings, openclaw),
      pai: this._fromSetup(setup.pai, "管家服务"),
      local: this._fromSetup(setup.ollama, "本地模型服务"),
    };
    const skills = {
      coding: this._codingBlock(coding, settings),
      comfyui: this._comfyBlock(setup.comfyui),
      browser: this._skillFlag(settings, "mogu.browser", "网页助手"),
      pc: this._skillFlag(settings, "mogu.pc", "电脑控制", runtime.pai),
      media: this._ffmpegBlock(setup.ffmpeg),
      remote: this._remoteSkill(settings, remote),
    };
    const remotes = this._remoteCenter(settings, remote, telegramToken);

    const items = [
      brain,
      runtime.openclaw,
      runtime.pai,
      runtime.local,
      skills.coding,
      skills.comfyui,
      skills.browser,
      skills.pc,
      skills.media,
      remotes.telegram,
      remotes.qq,
      remotes.wechat,
      docker,
    ].filter(Boolean);

    const notReady = items.filter((item) => !isReadyState(item.state) && item.required !== false);
    const overall = notReady.length === 0 ? "READY" : "NOT_READY";

    return {
      ok: true,
      controlPlaneEnabled,
      overall,
      label: overall === "READY" ? "一切就绪" : "还需要准备几项",
      brain,
      runtime,
      skills,
      remote: remotes,
      discovery: {
        ollama: runtime.local,
        models: Array.isArray(models?.models)
          ? models.models.map((m) => ({ name: m.name || m.model || String(m) })).slice(0, 40)
          : Array.isArray(models)
            ? models.map((m) => ({ name: typeof m === "string" ? m : m.name || m.model })).slice(0, 40)
            : [],
        openclaw: runtime.openclaw,
        pai: runtime.pai,
        comfyui: skills.comfyui,
        ffmpeg: skills.media,
        docker,
        coding: skills.coding,
      },
      issues: notReady.map((item) => ({
        id: item.id,
        title: item.title,
        state: item.state,
        reason: item.reason || publicLabel(item.state),
        fix: item.fix || "打开控制中心按提示处理",
      })),
      // Never expose ports/paths in public snapshot.
      internalsHidden: true,
    };
  }

  _brainBlock(settings, agentKeyConfigured, ollama, models) {
    const channel = settings.agentBrainChannel || "builtin";
    let state = "NotConfigured";
    let reason = "尚未选择 AI";
    let fix = "在控制中心选择本地或云端 AI";
    let model = "";
    let provider = "builtin";
    let endpoint = "";

    if (channel === "local") {
      provider = "Ollama";
      model = settings.agentLocalModel || "";
      endpoint = "local";
      const running = Boolean(ollama?.running);
      const installed = Boolean(ollama?.installed || running);
      if (!installed) {
        state = "Missing";
        reason = "本机还没有本地模型服务";
        fix = "安装本地模型服务，或改用云端 AI";
      } else if (!running) {
        state = "Installed";
        reason = "本地模型服务未运行";
        fix = "启动本地模型服务";
      } else if (!model) {
        state = "NotConfigured";
        reason = "尚未选择本地模型";
        fix = "选择一个已下载的本地模型";
      } else {
        state = "Healthy";
        reason = "本地 AI 可用";
        fix = "";
      }
    } else if (channel === "api") {
      provider = settings.agentApiPreset || "openai-compatible";
      model = settings.agentApiModel || "";
      endpoint = settings.agentApiBaseUrl ? "configured" : "";
      if (!settings.agentApiBaseUrl || !model) {
        state = "NotConfigured";
        reason = "云端 AI 未配置完整";
        fix = "填写服务地址与模型名，并保存密钥";
      } else if (!agentKeyConfigured && !/127\.0\.0\.1|localhost/i.test(String(settings.agentApiBaseUrl || ""))) {
        state = "NotConfigured";
        reason = "缺少访问密钥";
        fix = "在控制中心保存 API Key（加密存储）";
      } else {
        state = "Healthy";
        reason = "云端 AI 已配置";
        fix = "";
      }
    } else {
      state = "Disabled";
      reason = "内置引导模式（能力有限）";
      fix = "选择本地或云端 AI 以开始正式使用";
      provider = "builtin";
    }

    return {
      id: "brain",
      title: "AI 大脑",
      group: "brain",
      channel,
      provider,
      model,
      endpoint: endpoint === "local" || endpoint === "configured" ? endpoint : "",
      state: normalizeState(state),
      available: isReadyState(state),
      reason,
      fix,
      modelsAvailable: Array.isArray(models?.models) ? models.models.length : 0,
      required: channel === "builtin" ? false : true,
    };
  }

  _fromSetup(block = {}, title = "服务") {
    if (block.running) {
      return {
        id: title === "管家服务" ? "pai" : "ollama",
        title,
        group: "runtime",
        state: "Healthy",
        reason: "运行中",
        fix: "",
      };
    }
    if (block.installed) {
      return {
        id: title === "管家服务" ? "pai" : "ollama",
        title,
        group: "runtime",
        state: "Installed",
        reason: "已安装但未运行",
        fix: "在环境页启动该服务",
      };
    }
    return {
      id: title === "管家服务" ? "pai" : "ollama",
      title,
      group: "runtime",
      state: "Missing",
      reason: "未安装",
      fix: "按向导安装，或跳过（部分功能不可用）",
      required: false,
    };
  }

  _openclawBlock(settings, status = {}) {
    if (settings.openclawEnabled !== true) {
      return {
        id: "openclaw",
        title: "对话运行器",
        group: "runtime",
        state: "Disabled",
        reason: "未启用",
        fix: "需要时在设置中开启",
        required: false,
      };
    }
    if (status.connected || status.lifecycle === "connected") {
      return {
        id: "openclaw",
        title: "对话运行器",
        group: "runtime",
        state: "Healthy",
        reason: "已连接",
        fix: "",
      };
    }
    return {
      id: "openclaw",
      title: "对话运行器",
      group: "runtime",
      state: "NotConfigured",
      reason: status.message || "未连接",
      fix: "在 OpenClaw 页连接，或改用本机/云端直连大脑",
      required: false,
    };
  }

  _comfyBlock(comfy = {}) {
    if (comfy.running) {
      return { id: "comfyui", title: "图像创作", group: "skills", state: "Healthy", reason: "运行中", fix: "" };
    }
    if (comfy.found) {
      return {
        id: "comfyui",
        title: "图像创作",
        group: "skills",
        state: "Installed",
        reason: "已找到但未运行",
        fix: "启动图像创作服务",
        required: false,
      };
    }
    return {
      id: "comfyui",
      title: "图像创作",
      group: "skills",
      state: "Missing",
      reason: "未配置",
      fix: "需要时安装或指定位置",
      required: false,
    };
  }

  _ffmpegBlock(ffmpeg = {}) {
    if (ffmpeg.installed) {
      return { id: "ffmpeg", title: "视频工具", group: "skills", state: "Healthy", reason: "可用", fix: "" };
    }
    return {
      id: "ffmpeg",
      title: "视频工具",
      group: "skills",
      state: "Missing",
      reason: "未安装",
      fix: "做视频合成前请安装",
      required: false,
    };
  }

  _codingBlock(coding = {}, settings) {
    if (settings.skillsEnabled?.["mogu.coding"] === false) {
      return {
        id: "coding",
        title: "编程",
        group: "skills",
        state: "Disabled",
        reason: "已关闭",
        fix: "",
        required: false,
      };
    }
    if (coding?.ok === false && coding?.permissionDenied) {
      return {
        id: "coding",
        title: "编程",
        group: "skills",
        state: "PermissionDenied",
        reason: "权限不足",
        fix: "在权限中心确认",
      };
    }
    if (coding?.canInstallRuntime) {
      return {
        id: "coding",
        title: "编程",
        group: "skills",
        state: "Installed",
        reason: coding.ctaMessage || "引擎待完善",
        fix: "可一键安装适配版编程引擎",
        required: false,
      };
    }
    return {
      id: "coding",
      title: "编程",
      group: "skills",
      state: coding?.ok === false ? "NotConfigured" : "Healthy",
      reason: coding?.ctaMessage || (coding?.ok === false ? "未就绪" : "可用"),
      fix: coding?.ok === false ? "打开编程页按提示处理" : "",
      required: false,
    };
  }

  _skillFlag(settings, skillId, title, dependency) {
    if (settings.skillsEnabled?.[skillId] === false) {
      return { id: skillId, title, group: "skills", state: "Disabled", reason: "已关闭", fix: "", required: false };
    }
    if (dependency && !isReadyState(dependency.state)) {
      return {
        id: skillId,
        title,
        group: "skills",
        state: "NotConfigured",
        reason: `依赖「${dependency.title}」未就绪`,
        fix: dependency.fix || "先准备依赖服务",
        required: false,
      };
    }
    return { id: skillId, title, group: "skills", state: "Healthy", reason: "已启用", fix: "", required: false };
  }

  _remoteSkill(settings, remote) {
    if (settings.remote?.enabled !== true) {
      return {
        id: "remote",
        title: "远程控制",
        group: "skills",
        state: "Disabled",
        reason: "默认关闭",
        fix: "需要时在远程中心开启",
        required: false,
      };
    }
    if (remote?.running) {
      return { id: "remote", title: "远程控制", group: "skills", state: "Healthy", reason: "运行中", fix: "" };
    }
    return {
      id: "remote",
      title: "远程控制",
      group: "skills",
      state: "Installed",
      reason: "已启用但未运行",
      fix: "启动远程工作区",
      required: false,
    };
  }

  _remoteCenter(settings, remote, telegramToken) {
    const owner = settings.remoteOwner || {};
    const channels = settings.remote || {};
    const mk = (id, title, enabled, ownerId, tokenOk) => {
      if (!enabled) {
        return {
          id,
          title,
          group: "remote",
          state: "Disabled",
          reason: "未开启",
          fix: "需要时绑定并开启",
          owner: "",
          tokenConfigured: false,
          required: false,
        };
      }
      if (!ownerId) {
        return {
          id,
          title,
          group: "remote",
          state: "NotConfigured",
          reason: "未绑定主人",
          fix: "绑定你的账号后才能使用",
          owner: "",
          tokenConfigured: Boolean(tokenOk),
          required: false,
        };
      }
      if (id === "telegram" && !tokenOk) {
        return {
          id,
          title,
          group: "remote",
          state: "NotConfigured",
          reason: "未保存连接凭证",
          fix: "在远程中心安全保存 Token",
          owner: String(ownerId),
          tokenConfigured: false,
          required: false,
        };
      }
      const running = remote?.running && (remote.channels || []).includes(id.replace("remote.", ""));
      return {
        id,
        title,
        group: "remote",
        state: running || remote?.running ? "Healthy" : "Installed",
        reason: running || remote?.running ? "已连接" : "已配置",
        fix: "",
        owner: String(ownerId),
        tokenConfigured: Boolean(tokenOk),
        permission: channels.requireApproval !== false ? "需确认高风险操作" : "自动执行（不推荐）",
        required: false,
      };
    };

    return {
      telegram: mk(
        "telegram",
        "Telegram",
        channels.telegram?.enabled === true || channels.telegram === true,
        owner.telegramUserId,
        telegramToken
      ),
      qq: mk("qq", "QQ", channels.qq?.enabled === true || channels.qq === true, owner.qqUserId, false),
      wechat: mk(
        "wechat",
        "微信",
        channels.wechat?.enabled === true || channels.wechat === true,
        owner.wechatUserId,
        false
      ),
    };
  }

  async _secretHas(key) {
    const store = this.deps.secretStore;
    if (!store) return false;
    try {
      if (typeof store.has === "function") return Boolean(await store.has(key));
      if (typeof store.hasReference === "function") return Boolean(await store.hasReference(key));
    } catch {
      return false;
    }
    return false;
  }

  async _safe(fn) {
    if (typeof fn !== "function") return null;
    try {
      return await fn();
    } catch {
      return null;
    }
  }
}

module.exports = { CapabilityRegistry };

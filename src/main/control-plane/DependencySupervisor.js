"use strict";

/**
 * DependencySupervisor — preflight dependency hints before skill/task work.
 * Does not auto-install unless autoInstallRuntime / autoStartServices (Default-Off).
 */
const RULES = Object.freeze([
  {
    id: "video",
    match: /(生成视频|做视频|出片|comfy|工作流|文生视频|图生视频)/i,
    requires: ["comfyui"],
  },
  {
    id: "pc",
    match: /(打开应用|本机命令|搜索文件|帮我点|桌面操作|mogu_pc)/i,
    requires: ["pai"],
  },
  {
    id: "media",
    match: /(拼接视频|视频合成|ffmpeg|合成片段)/i,
    requires: ["ffmpeg"],
  },
  {
    id: "local-brain",
    match: /./,
    whenChannel: "local",
    requires: ["ollama"],
  },
]);

class DependencySupervisor {
  /**
   * @param {{ registry: { snapshot: Function }, getSettings: Function }} deps
   */
  constructor(deps = {}) {
    this.deps = deps;
  }

  /**
   * @param {{ text?: string, skillId?: string }} input
   */
  async check(input = {}) {
    const settings = await this.deps.getSettings();
    const autoStart = settings.autoStartServices === true;
    const autoInstall = settings.autoInstallRuntime === true;
    const text = String(input.text || "");
    const skillId = String(input.skillId || "");

    const snap = await this.deps.registry.snapshot();
    const byId = indexCapabilities(snap);

    const needed = new Set();
    if (skillId === "mogu.comfy" || skillId === "mogu.studio") needed.add("comfyui");
    if (skillId === "mogu.pc") needed.add("pai");
    if (skillId === "mogu.media") needed.add("ffmpeg");
    if (skillId === "mogu.coding") needed.add("coding");

    for (const rule of RULES) {
      if (rule.whenChannel && settings.agentBrainChannel !== rule.whenChannel) continue;
      if (rule.match && text && rule.match.test(text)) {
        for (const req of rule.requires) needed.add(req);
      }
    }

    const missing = [];
    for (const id of needed) {
      const cap = byId.get(id);
      if (!cap) continue;
      const ready = ["Healthy", "Running"].includes(cap.state) || (id === "ffmpeg" && cap.state === "Installed");
      if (ready) continue;
      missing.push({
        id,
        title: cap.title,
        reason: cap.reason || "未就绪",
        actions: buildActions(id, { autoStart, autoInstall }),
      });
    }

    return {
      ok: missing.length === 0,
      blocked: missing.length > 0,
      autoStartServices: autoStart,
      autoInstallRuntime: autoInstall,
      missing,
      message:
        missing.length === 0
          ? "依赖已就绪"
          : `还需要：${missing.map((m) => m.title).join("、")}`,
    };
  }
}

function indexCapabilities(snap) {
  const map = new Map();
  const put = (item) => {
    if (item?.id) map.set(item.id, item);
  };
  put(snap.brain);
  put(snap.runtime?.pai);
  put(snap.runtime?.local);
  put(snap.runtime?.openclaw);
  put(snap.skills?.coding);
  put(snap.skills?.comfyui);
  put(snap.skills?.media);
  put(snap.skills?.pc);
  // aliases
  if (snap.runtime?.pai) map.set("pai", snap.runtime.pai);
  if (snap.runtime?.local) map.set("ollama", snap.runtime.local);
  if (snap.skills?.comfyui) map.set("comfyui", snap.skills.comfyui);
  if (snap.skills?.media) map.set("ffmpeg", snap.skills.media);
  if (snap.skills?.coding) map.set("coding", snap.skills.coding);
  return map;
}

function buildActions(id, { autoStart, autoInstall }) {
  const actions = [];
  if (id === "comfyui") {
    actions.push({ id: "install", label: "安装" });
    actions.push({ id: "configure", label: "手动配置" });
    actions.push({ id: "skip", label: "跳过" });
  } else if (id === "pai" || id === "ollama") {
    if (autoStart) actions.push({ id: "start", label: "启动" });
    else actions.push({ id: "start", label: "启动" });
    if (autoInstall) actions.push({ id: "install", label: "安装" });
    else actions.push({ id: "install", label: "安装" });
    actions.push({ id: "skip", label: "跳过" });
  } else if (id === "ffmpeg") {
    actions.push({ id: "install", label: "安装" });
    actions.push({ id: "skip", label: "跳过" });
  } else {
    actions.push({ id: "fix", label: "去处理" });
    actions.push({ id: "skip", label: "跳过" });
  }
  return actions;
}

module.exports = { DependencySupervisor, RULES };

"use strict";

const { publicLabel } = require("./CapabilityTypes");
const { probeDockerInstalled } = require("./docker-probe");

/**
 * Discovery — wraps CapabilityRegistry snapshot into READY / NOT_READY + user fixes.
 * Hides ports, paths, and internal module names.
 */
class CapabilityDiscovery {
  constructor({ registry, probeDocker } = {}) {
    this.registry = registry;
    this.probeDocker = probeDocker;
  }

  async discover() {
    const snap = await this.registry.snapshot();
    const issues = (snap.issues || []).map((item) => ({
      title: item.title,
      reason: item.reason,
      fix: item.fix,
      stateLabel: publicLabel(item.state),
    }));

    const docker =
      snap.discovery?.docker ||
      (typeof this.probeDocker === "function" ? await this.probeDocker() : await probeDockerInstalled());

    return {
      ok: true,
      status: snap.overall,
      message: snap.label,
      brain: {
        title: snap.brain?.title,
        stateLabel: publicLabel(snap.brain?.state),
        model: snap.brain?.model || "",
        provider: snap.brain?.provider || "",
        reason: snap.brain?.reason || "",
        fix: snap.brain?.fix || "",
      },
      checklist: [
        row("本地模型服务", snap.discovery?.ollama),
        row("本地模型列表", {
          state: (snap.discovery?.models || []).length ? "Healthy" : "NotConfigured",
          reason: (snap.discovery?.models || []).length
            ? `已发现 ${(snap.discovery.models || []).length} 个模型`
            : "暂无本地模型",
          fix: "下载一个本地模型，或改用云端 AI",
        }),
        row("对话运行器", snap.discovery?.openclaw),
        row("管家服务", snap.discovery?.pai),
        row("图像创作", snap.discovery?.comfyui),
        row("视频工具", snap.discovery?.ffmpeg),
        row("编程", snap.discovery?.coding),
        row("容器工具", docker),
      ],
      issues,
      models: (snap.discovery?.models || []).map((m) => m.name).filter(Boolean),
    };
  }
}

function row(title, block = {}) {
  return {
    title,
    stateLabel: publicLabel(block.state),
    ready: ["Healthy", "Running", "Installed"].includes(String(block.state || "")),
    reason: block.reason || publicLabel(block.state),
    fix: block.fix || "",
  };
}

module.exports = { CapabilityDiscovery };

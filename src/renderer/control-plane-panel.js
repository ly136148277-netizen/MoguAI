const ControlPlanePanel = (() => {
  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text || "";
  }

  async function refresh() {
    const api = window.modelManager;
    if (!api?.controlPlaneStatus) return;
    try {
      const status = await api.controlPlaneStatus();
      if (status.controlPlaneEnabled === false) {
        setText("cp-overall", "控制中心未开启（默认关闭）");
        setText("cp-brain", "—");
        setText("cp-issues", "完成首次向导或点击下方「开启控制中心」。");
        return;
      }
      setText("cp-overall", `${status.overall || "?"} · ${status.label || ""}`);
      const brain = status.brain || {};
      setText(
        "cp-brain",
        `${brain.provider || "-"} / ${brain.model || "-"} · ${brain.reason || brain.state || ""}`
      );
      const issues = (status.issues || [])
        .map((i) => `· ${i.title}：${i.reason}${i.fix ? ` → ${i.fix}` : ""}`)
        .join("\n");
      setText("cp-issues", issues || "暂无待处理项");

      const remote = await api.controlPlaneRemoteStatus?.();
      const tg = remote?.channels?.telegram;
      setText(
        "cp-remote",
        tg
          ? `Telegram：${tg.connected ? "已连接" : tg.enabled ? "已配置" : "关闭"} · Owner ${tg.owner || "未绑定"} · Token ${
              tg.tokenConfigured ? "已保存" : "无"
            }`
          : "—"
      );
    } catch (error) {
      setText("cp-overall", error.message || String(error));
    }
  }

  async function applyBrain(channel) {
    const api = window.modelManager;
    const statusEl = $("cp-brain-status");
    try {
      if (channel === "local") {
        const models = await api.controlPlaneBrainModels?.();
        const name =
          $("cp-local-model")?.value?.trim() ||
          models?.models?.[0]?.name ||
          "qwen2.5-coder:7b";
        const result = await api.controlPlaneBrainSet({
          channel: "local",
          localModel: name,
          test: true,
        });
        if (statusEl) {
          statusEl.textContent = result.ok
            ? `已切换本地：${name}${result.test?.ok === false ? `（检测：${result.test.error || "失败"}）` : "（立即生效）"}`
            : result.error || "切换失败";
        }
      } else if (channel === "api") {
        const result = await api.controlPlaneBrainSet({
          channel: "api",
          apiPreset: $("cp-api-preset")?.value || "custom",
          apiBaseUrl: $("cp-api-base")?.value?.trim(),
          apiModel: $("cp-api-model")?.value?.trim(),
          apiKey: $("cp-api-key")?.value || undefined,
          test: true,
        });
        if ($("cp-api-key")) $("cp-api-key").value = "";
        if (statusEl) {
          statusEl.textContent = result.ok
            ? `已切换云端：${result.brain?.apiModel || ""}${
                result.test?.ok === false ? `（检测：${result.test.error || "失败"}）` : "（立即生效）"
              }`
            : result.error || "切换失败";
      }
      await refresh();
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message;
    }
  }

  function init() {
    $("cp-refresh")?.addEventListener("click", () => refresh());
    $("cp-enable")?.addEventListener("click", async () => {
      await window.modelManager.controlPlaneEnable?.({ enabled: true });
      await refresh();
    });
    $("cp-use-local")?.addEventListener("click", () => applyBrain("local"));
    $("cp-use-api")?.addEventListener("click", () => applyBrain("api"));
    $("cp-wizard-local")?.addEventListener("click", async () => {
      const choice = await window.modelManager.controlPlaneWizardChooseAi?.({ choice: "local" });
      if (choice?.ok) {
        await applyBrain("local");
        await window.modelManager.controlPlaneWizardComplete?.();
        setText("cp-wizard-hint", "向导完成：已选择本地 AI。");
        await refresh();
      }
    });
    $("cp-wizard-openai")?.addEventListener("click", async () => {
      const choice = await window.modelManager.controlPlaneWizardChooseAi?.({ choice: "openai" });
      if (choice?.ok) {
        if ($("cp-api-base")) $("cp-api-base").value = choice.payload.apiBaseUrl || "";
        if ($("cp-api-model")) $("cp-api-model").value = choice.payload.apiModel || "";
        setText("cp-wizard-hint", choice.hint || "请填写密钥后点「使用云端」");
      }
    });
    $("cp-deps-check")?.addEventListener("click", async () => {
      const text = $("cp-deps-text")?.value || "帮我生成视频";
      const result = await window.modelManager.controlPlaneDepsCheck?.({ text });
      setText(
        "cp-deps-result",
        result?.ok
          ? "依赖就绪"
          : `${result?.message || "缺少依赖"}\n${(result?.missing || [])
              .map((m) => `· ${m.title}：${m.reason}`)
              .join("\n")}`
      );
    });

    window.AppRouter?.onPage?.("control-plane", () => refresh());
  }

  return { init, refresh };
})();

window.ControlPlanePanel = ControlPlanePanel;

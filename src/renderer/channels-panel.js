const ChannelsPanel = (() => {
  function init() {
    document.getElementById("channels-goto-openclaw")?.addEventListener("click", () => {
      window.AppRouter.navigate("openclaw");
    });
    document.getElementById("channels-open-docs")?.addEventListener("click", async () => {
      try {
        await window.modelManager.openOpenclawInstallDocs?.();
        const el = document.getElementById("channels-status");
        if (el) el.textContent = "已打开 OpenClaw 官方文档（渠道配置见文档）。";
      } catch (error) {
        const el = document.getElementById("channels-status");
        if (el) el.textContent = error.message;
      }
    });
    window.AppRouter.onPage("channels", async () => {
      try {
        const life = await window.modelManager.getOpenclawLifecycle?.();
        const el = document.getElementById("channels-status");
        if (el) {
          el.textContent = life?.connected
            ? `Gateway 已连接 · ${life.serverVersion || life.message || ""}`
            : `Gateway：${life?.lifecycle || life?.message || "未连接"}`;
        }
      } catch {
        /* ignore */
      }
    });
  }

  return { init };
})();

window.ChannelsPanel = ChannelsPanel;

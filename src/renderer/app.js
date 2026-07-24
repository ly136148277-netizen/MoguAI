const AppRouter = (() => {
  let currentPage = "chat";
  let currentOptions = {};
  const handlers = {};
  /** @type {{ page: string, options: object }[]} */
  const history = [];

  /** Sidebar highlight groups: child pages keep parent nav active (v1.6 §6.5 IA). */
  const NAV_GROUPS = {
    home: ["home"],
    models: ["models", "downloads", "my-models"],
    agent: ["chat", "butler", "agent-intro"],
    tasks: ["tasks"],
    factory: ["factory"],
    create: ["studio", "comfyui", "compose"],
    env: ["setup", "data"],
    settings: ["settings", "control-plane", "openclaw", "skills", "permissions", "channels"],
    help: ["help"],
  };

  function groupForPage(page) {
    for (const [group, pages] of Object.entries(NAV_GROUPS)) {
      if (pages.includes(page)) return group;
    }
    return page;
  }

  function syncNavActive(page) {
    const group = groupForPage(page);
    document.querySelectorAll(".sidebar [data-nav]").forEach((button) => {
      const btnGroup = button.dataset.navGroup || button.dataset.nav;
      button.classList.toggle("is-active", btnGroup === group);
    });
    document.querySelectorAll(".hub-tab[data-hub-nav]").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.hubNav === page);
    });
    // 下载时选路径，顶栏不再展示保存位置
    document.getElementById("header-storage")?.classList.add("hidden");
  }

  function init() {
    document.querySelectorAll(".sidebar [data-nav]").forEach((button) => {
      button.addEventListener("click", () => {
        const prefill = button.dataset.butlerPrefill;
        const options = prefill != null ? { butlerPrefill: prefill } : {};
        // 侧栏点「模型」回到双入口
        if (button.dataset.nav === "models") {
          options.modelsMode = "gate";
          sessionStorage.setItem("modelsMode", "gate");
        }
        navigate(button.dataset.nav, options);
      });
    });
    document.querySelectorAll("[data-hub-nav]").forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.disabled) return;
        const options = {};
        if (tab.dataset.modelsMode) {
          options.modelsMode = tab.dataset.modelsMode;
          sessionStorage.setItem("modelsMode", tab.dataset.modelsMode);
        }
        navigate(tab.dataset.hubNav, options);
      });
    });
    handlers[currentPage]?.({});
    syncNavActive(currentPage);
  }

  function navigate(page, options = {}) {
    if (!document.getElementById(`view-${page}`)) {
      return;
    }

    if (options?.butlerPrefill != null) {
      sessionStorage.setItem("butlerPrefill", options.butlerPrefill);
    }

    // 前进时压入历史（replace/back 不压）
    if (!options.replace && !options.back && page !== currentPage) {
      history.push({
        page: currentPage,
        options: { ...currentOptions },
      });
      if (history.length > 40) history.shift();
    }

    document.querySelectorAll(".view").forEach((view) => view.classList.remove("is-active"));
    document.getElementById(`view-${page}`).classList.add("is-active");

    syncNavActive(page);

    currentPage = page;
    currentOptions = { ...options };
    delete currentOptions.replace;
    delete currentOptions.back;
    handlers[page]?.(options);
  }

  /** 返回上一页；无历史则回首页 */
  function goBack() {
    // 模型页内：本地/联网 → 先回到双入口
    if (currentPage === "models") {
      const mode = window.ModelsHub?.getMode?.();
      if (mode === "local" || mode === "online") {
        window.ModelsHub.showGate();
        return true;
      }
    }

    while (history.length) {
      const prev = history.pop();
      if (!prev || prev.page === currentPage) continue;
      navigate(prev.page, { ...(prev.options || {}), back: true });
      return true;
    }

    if (currentPage !== "chat") {
      navigate("chat", { back: true });
      return true;
    }
    return false;
  }

  function onPage(page, callback) {
    handlers[page] = callback;
  }

  function getCurrentPage() {
    return currentPage;
  }

  function canGoBack() {
    if (currentPage === "models") {
      const mode = window.ModelsHub?.getMode?.();
      if (mode === "local" || mode === "online") return true;
    }
    return history.length > 0 || currentPage !== "chat";
  }

  return { init, navigate, goBack, onPage, getCurrentPage, groupForPage, canGoBack };
})();

window.AppRouter = AppRouter;

const PageController = (() => {
  function bindBackHome() {
    document.querySelectorAll(".back-home-btn").forEach((button) => {
      button.textContent = "← 返回";
      button.setAttribute("aria-label", "返回上一页");
      button.addEventListener("click", () => window.AppRouter.goBack());
    });
  }

  function registerPages() {
    window.AppRouter.onPage("home", () => window.AppCore.loadDashboard());
    window.AppRouter.onPage("models", (options) => {
      window.ModelsHub?.onEnter?.(options || {});
    });
    window.AppRouter.onPage("downloads", () => {
      sessionStorage.setItem("modelsMode", "local");
      window.AppCore.loadQueue();
    });
    window.AppRouter.onPage("my-models", () => {
      sessionStorage.setItem("modelsMode", "local");
      window.MyModelsPage.load();
    });
    window.AppRouter.onPage("settings", () => window.AppCore.loadSettingsForm());
    window.AppRouter.onPage("help", () => {});
  }

  function init() {
    registerPages();
    bindBackHome();
    window.ModelsHub?.init?.();
    window.AppRouter.init();
    window.AgentPanel?.init?.();
  }

  return { init, registerPages, bindBackHome };
})();

window.PageController = PageController;

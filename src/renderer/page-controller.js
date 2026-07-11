const PageController = (() => {
  function bindBackHome() {
    document.querySelectorAll(".back-home-btn").forEach((button) => {
      button.addEventListener("click", () => window.AppRouter.navigate("home"));
    });
  }

  function registerPages() {
    window.AppRouter.onPage("home", () => window.AppCore.loadDashboard());
    window.AppRouter.onPage("models", () => window.AppCore.loadModels());
    window.AppRouter.onPage("downloads", () => window.AppCore.loadQueue());
    window.AppRouter.onPage("my-models", () => window.MyModelsPage.load());
    window.AppRouter.onPage("settings", () => window.AppCore.loadSettingsForm());
    window.AppRouter.onPage("help", () => {});
  }

  function init() {
    registerPages();
    bindBackHome();
    window.AppRouter.init();
  }

  return { init, registerPages, bindBackHome };
})();

window.PageController = PageController;

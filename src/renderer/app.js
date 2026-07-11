const AppRouter = (() => {
  let currentPage = "home";
  const handlers = {};

  function init() {
    document.querySelectorAll("[data-nav]").forEach((button) => {
      button.addEventListener("click", () => {
        const prefill = button.dataset.butlerPrefill;
        navigate(button.dataset.nav, prefill != null ? { butlerPrefill: prefill } : undefined);
      });
    });
    handlers[currentPage]?.();
  }

  function navigate(page, options) {
    if (!document.getElementById(`view-${page}`)) {
      return;
    }

    if (options?.butlerPrefill != null) {
      sessionStorage.setItem("butlerPrefill", options.butlerPrefill);
    }

    document.querySelectorAll(".view").forEach((view) => view.classList.remove("is-active"));
    document.getElementById(`view-${page}`).classList.add("is-active");

    document.querySelectorAll("[data-nav]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.nav === page);
    });

    currentPage = page;
    handlers[page]?.();
  }

  function onPage(page, callback) {
    handlers[page] = callback;
  }

  function getCurrentPage() {
    return currentPage;
  }

  return { init, navigate, onPage, getCurrentPage };
})();

window.AppRouter = AppRouter;

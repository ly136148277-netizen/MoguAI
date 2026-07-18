const OpenclawPanel = (() => {
  const els = {};

  function init() {
    els.state = document.getElementById("oc-life-state");
    els.message = document.getElementById("oc-life-message");
    els.version = document.getElementById("oc-life-version");
    els.pinned = document.getElementById("oc-life-pinned");
    els.guide = document.getElementById("oc-life-guide");
    els.refresh = document.getElementById("oc-life-refresh-btn");
    els.probe = document.getElementById("oc-life-probe-btn");
    els.connect = document.getElementById("oc-life-connect-btn");
    els.disconnect = document.getElementById("oc-life-disconnect-btn");
    els.start = document.getElementById("oc-life-start-btn");
    els.stop = document.getElementById("oc-life-stop-btn");
    els.docs = document.getElementById("oc-life-docs-btn");

    els.refresh?.addEventListener("click", () => refresh());
    els.probe?.addEventListener("click", () => probe());
    els.connect?.addEventListener("click", () => connect());
    els.disconnect?.addEventListener("click", () => disconnect());
    els.start?.addEventListener("click", () => startGw());
    els.stop?.addEventListener("click", () => stopGw());
    els.docs?.addEventListener("click", () => openDocs());

    if (window.modelManager?.onOpenclawState) {
      // Paint from event only — never re-enter lifecycle/probe (that caused probing flicker loops).
      window.modelManager.onOpenclawState((status) => {
        if (els.version) {
          els.version.textContent = status?.hello?.serverVersion
            ? `服务端 ${status.hello.serverVersion}`
            : `Bridge ${status?.state || "disconnected"}`;
        }
        if (els.state && status?.state) {
          els.state.textContent = status.connected ? "connected" : status.state;
        }
        if (els.message && status?.state) {
          els.message.textContent = status.connected
            ? "已连接 Gateway"
            : `Bridge 状态：${status.state}`;
        }
      });
    }
    window.AppRouter.onPage("openclaw", () => refresh());
  }

  let refreshInFlight = false;
  async function refresh() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const life = await window.modelManager.getOpenclawLifecycle();
      if (els.state) els.state.textContent = life.lifecycle || "unknown";
      if (els.message) els.message.textContent = life.message || "";
      if (els.version) {
        els.version.textContent = life.serverVersion
          ? `服务端 ${life.serverVersion}`
          : `Bridge ${life.bridgeState || "disconnected"}`;
      }
      if (els.pinned) {
        els.pinned.textContent = life.pinned?.label || "protocol 4";
      }
      if (els.guide) {
        const steps = life.guide?.steps || [];
        els.guide.innerHTML = steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
      }
    } catch (error) {
      if (els.message) els.message.textContent = error.message;
    } finally {
      refreshInFlight = false;
    }
  }

  async function probe() {
    try {
      const settings = await window.modelManager.getSettings();
      const result = await window.modelManager.probeOpenclaw({
        url: settings.openclawGatewayUrl,
        mutateState: false,
      });
      window.AppCore?.setStatus?.(
        result?.reachable ? "Gateway 可探测" : `不可达：${result?.error || "offline"}`
      );
      await refresh();
    } catch (error) {
      window.AppCore?.setStatus?.(`探测失败：${error.message}`);
    }
  }

  async function connect() {
    try {
      const settings = await window.modelManager.getSettings();
      await window.modelManager.connectOpenclaw({ url: settings.openclawGatewayUrl });
      window.AppCore?.setStatus?.("已请求连接 OpenClaw");
      await refresh();
    } catch (error) {
      const msg = String(error?.message || error);
      const needsInstall = /未检测|未找到|请先安装 OpenClaw|openclaw CLI|自动启动失败/i.test(msg);
      window.AppCore?.setStatus?.(
        needsInstall ? `${msg} · 请点下方「官方安装文档」安装后重试` : `连接失败：${msg}`
      );
      await refresh();
    }
  }

  async function disconnect() {
    try {
      await window.modelManager.disconnectOpenclaw();
      await refresh();
    } catch (error) {
      window.AppCore?.setStatus?.(`断开失败：${error.message}`);
    }
  }

  async function startGw() {
    try {
      const result = await window.modelManager.startOpenclaw();
      window.AppCore?.setStatus?.(
        result?.ok
          ? result.alreadyRunning
            ? "Gateway 已由 MOGU 拉起"
            : `已尝试启动外部 Gateway (pid ${result.pid || "?"})`
          : result?.message || result?.error || "启动失败"
      );
      await refresh();
    } catch (error) {
      window.AppCore?.setStatus?.(`启动失败：${error.message}`);
    }
  }

  async function stopGw() {
    try {
      const result = await window.modelManager.stopOpenclaw();
      window.AppCore?.setStatus?.(result?.message || (result?.stopped ? "已停止" : "无托管进程"));
      await refresh();
    } catch (error) {
      window.AppCore?.setStatus?.(`停止失败：${error.message}`);
    }
  }

  async function openDocs() {
    try {
      const guide = await window.modelManager.getOpenclawInstallGuide();
      if (guide?.installDocsUrl) {
        window.open(guide.installDocsUrl, "_blank", "noopener");
      }
    } catch {
      // ignore
    }
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { init, refresh };
})();

window.OpenclawPanel = OpenclawPanel;

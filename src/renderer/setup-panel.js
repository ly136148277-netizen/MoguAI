const SetupPanel = (() => {
  const els = {};
  let unsubProgress = null;

  function init() {
    els.ollamaBadge = document.getElementById("setup-ollama-badge");
    els.ollamaText = document.getElementById("setup-ollama-text");
    els.paiBadge = document.getElementById("setup-pai-badge");
    els.paiText = document.getElementById("setup-pai-text");
    els.comfyBadge = document.getElementById("setup-comfy-badge");
    els.comfyText = document.getElementById("setup-comfy-text");
    els.ffmpegBadge = document.getElementById("setup-ffmpeg-badge");
    els.ffmpegText = document.getElementById("setup-ffmpeg-text");
    els.executorBadge = document.getElementById("setup-executor-badge");
    els.executorText = document.getElementById("setup-executor-text");
    els.log = document.getElementById("setup-log");
    els.ollamaInstall = document.getElementById("setup-ollama-install-btn");
    els.ollamaStart = document.getElementById("setup-ollama-start-btn");
    els.paiInstall = document.getElementById("setup-pai-install-btn");
    els.paiPick = document.getElementById("setup-pai-pick-btn");
    els.paiStart = document.getElementById("setup-pai-start-btn");
    els.comfyGuide = document.getElementById("setup-comfy-guide-btn");
    els.comfyScan = document.getElementById("setup-comfy-scan-btn");
    els.ffmpegInstall = document.getElementById("setup-ffmpeg-install-btn");
    els.refresh = document.getElementById("setup-refresh-btn");
    els.gotoStudio = document.getElementById("setup-goto-studio-btn");
    els.executorOpenclaw = document.getElementById("setup-executor-openclaw-btn");
    els.executorPai = document.getElementById("setup-executor-pai-btn");
    els.executorBrain = document.getElementById("setup-executor-brain-btn");
    els.executorGotoAgent = document.getElementById("setup-executor-goto-agent-btn");

    els.ollamaInstall?.addEventListener("click", () => runAction("ollama-install"));
    els.ollamaStart?.addEventListener("click", () => runAction("ollama-start"));
    els.paiInstall?.addEventListener("click", () => runAction("pai-install"));
    els.paiPick?.addEventListener("click", () => runAction("pai-pick"));
    els.paiStart?.addEventListener("click", () => runAction("pai-start"));
    els.comfyGuide?.addEventListener("click", () => runAction("comfy-guide"));
    els.comfyScan?.addEventListener("click", () => runAction("comfy-scan"));
    els.ffmpegInstall?.addEventListener("click", () => runAction("ffmpeg-install"));
    els.refresh?.addEventListener("click", () => refresh());
    els.gotoStudio?.addEventListener("click", () => window.AppRouter.navigate("studio"));
    els.executorOpenclaw?.addEventListener("click", () => setExecutor("openclaw"));
    els.executorPai?.addEventListener("click", () => setExecutor("pai"));
    els.executorBrain?.addEventListener("click", () => {
      window.AppRouter.navigate("settings");
      appendLog("请在设置中选择联网 API 或本机模型，保存后回对话。");
    });
    els.executorGotoAgent?.addEventListener("click", () => {
      window.AppRouter.navigate("agent");
      appendLog("已打开对话：可先说「怎么用创作台」做安全试用。");
    });

    if (window.modelManager?.onSetupProgress) {
      unsubProgress = window.modelManager.onSetupProgress((payload) => {
        appendLog(`[${payload.target || "setup"}] ${payload.message || payload.phase || ""}`);
      });
    }

    window.AppRouter.onPage("setup", () => refresh());
    maybeShowWizard();
  }

  async function setExecutor(mode) {
    try {
      const next =
        mode === "pai"
          ? { agentRuntimeMode: "pai", openclawEnabled: false }
          : { agentRuntimeMode: "openclaw", openclawEnabled: true };
      await window.modelManager.updateSettings(next);
      appendLog(
        mode === "pai"
          ? "已选择 PAI。请确保下方 PAI 引擎已安装并启动，再到对话发送指令。"
          : "已选择 OpenClaw。请连接 Gateway 后再到对话发送指令；不会因大脑未配置而拦死。"
      );
      await refresh();
    } catch (error) {
      appendLog(`切换执行方失败：${error.message || error}`);
    }
  }

  async function maybeShowWizard() {
    try {
      const settings = await window.modelManager.getSettings();
      if (!settings.showSetupWizard) return;
      const status = await window.modelManager.getSetupStatus();
      if (status.allReady) {
        await window.modelManager.dismissSetupWizard();
        return;
      }
      window.AppRouter.navigate("setup");
      appendLog("首次使用：请按卡片顺序安装/扫描环境。完成后可点「去创作台」。");
    } catch {
      // ignore
    }
  }

  function setBadge(el, ok, text) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("badge--danger", !ok);
  }

  function appendLog(line) {
    if (!els.log) return;
    const stamp = new Date().toLocaleTimeString();
    els.log.textContent = `${els.log.textContent}\n[${stamp}] ${line}`.trim();
    els.log.scrollTop = els.log.scrollHeight;
  }

  async function refresh() {
    try {
      if (window.modelManager.refreshNetworkProxy) {
        const net = await window.modelManager.refreshNetworkProxy();
        if (net?.ok) {
          appendLog(
            `网络已刷新（跟随系统）${net.httpProxy ? ` · 代理 ${net.httpProxy}` : " · 当前直连"} · 本机不走代理`
          );
        }
      }
      const status = await window.modelManager.getSetupStatus();
      const o = status.ollama || {};
      const p = status.pai || {};
      const c = status.comfyui || {};
      const f = status.ffmpeg || {};

      try {
        const settings = await window.modelManager.getSettings();
        const mode = settings.agentRuntimeMode === "pai" ? "pai" : "openclaw";
        const brain = settings.agentBrainChannel || "builtin";
        const oc = settings.openclaw || (await window.modelManager.getOpenclawStatus?.());
        const ocOk = Boolean(oc && (oc.connected === true || oc.state === "ready"));
        if (mode === "openclaw") {
          setBadge(els.executorBadge, ocOk, ocOk ? "OpenClaw 已连" : "OpenClaw 未连");
          if (els.executorText) {
            els.executorText.textContent = ocOk
              ? `当前执行方：OpenClaw（大脑通道：${brain}）。可直接去对话发指令。`
              : `当前执行方：OpenClaw（未连接）。请连接 Gateway，或改选 PAI / 配置大脑——不会静默切换。`;
          }
        } else {
          setBadge(els.executorBadge, Boolean(p.running), p.running ? "PAI 就绪" : "PAI 未就绪");
          if (els.executorText) {
            els.executorText.textContent = p.running
              ? `当前执行方：PAI（大脑通道：${brain}）。可去对话发指令。`
              : `当前执行方：PAI。请先安装并启动下方 PAI 引擎。`;
          }
        }
      } catch {
        setBadge(els.executorBadge, false, "未知");
      }

      setBadge(els.ollamaBadge, o.running, o.running ? "运行中" : o.installed ? "已装未运行" : "未安装");
      if (els.ollamaText) {
        els.ollamaText.textContent = o.running
          ? "Ollama API 正常，可下载模型并聊天。"
          : o.installed
            ? "已安装但未运行，请点击启动。"
            : "未检测到 Ollama，可一键安装（winget 或官方安装包）。";
      }

      setBadge(els.paiBadge, p.running, p.running ? "运行中" : p.installed ? "已装未启动" : "未安装");
      if (els.paiText) {
        els.paiText.textContent = p.paiRoot
          ? `路径：${p.paiRoot}${p.running ? " · 服务已连接" : ""}`
          : "未绑定 PAI。可一键安装到用户目录，或选择已有文件夹。";
      }

      const comfyOk = Boolean(c.running);
      setBadge(
        els.comfyBadge,
        comfyOk,
        comfyOk ? "已连接" : c.found ? "已找到未运行/未写入" : "未找到"
      );
      if (els.comfyText) {
        els.comfyText.textContent = c.path
          ? `路径：${c.path}${c.api ? ` · ${c.api}` : ""}${c.pendingWrite ? " · 待写入 PAI" : ""}`
          : "请下载便携包解压后点「扫描」。";
      }

      const ffmpegOk = Boolean(f.installed);
      setBadge(els.ffmpegBadge, ffmpegOk, ffmpegOk ? "已就绪" : "未安装");
      if (els.ffmpegText) {
        const sourceHint =
          f.source === "managed"
            ? "（软件目录）"
            : f.source === "bundled"
              ? "（随包装载）"
              : f.source === "path" || f.source === "winget"
                ? "（系统）"
                : "";
        els.ffmpegText.textContent = ffmpegOk
          ? `已就绪${sourceHint}${f.version ? ` · ${f.version}` : ""} · 可用于拼接/转码`
          : "未检测到 FFmpeg。点「一键安装」会下载便携版到软件目录（换电脑也可），失败再试系统安装。";
      }
    } catch (error) {
      appendLog(`刷新失败：${error.message}`);
    }
  }

  async function runAction(action) {
    setBusy(true);
    try {
      if (action === "ollama-install") {
        appendLog("开始安装 Ollama…");
        const result = await window.modelManager.installOllamaSetup();
        appendLog(result.needsManualFinish ? "已打开安装程序，完成后请刷新。" : JSON.stringify(result));
      } else if (action === "ollama-start") {
        await window.modelManager.startOllama();
        appendLog("已请求启动 Ollama");
      } else if (action === "pai-install") {
        appendLog("开始安装/绑定 PAI…");
        const result = await window.modelManager.installPaiSetup();
        appendLog(result.ok ? `PAI 就绪：${result.paiRoot}` : result.error || "失败");
      } else if (action === "pai-pick") {
        const result = await window.modelManager.pickPaiRoot();
        if (!result.cancelled) appendLog(`已绑定：${result.paiRoot}`);
      } else if (action === "pai-start") {
        await window.modelManager.ensurePai();
        appendLog("已启动 PAI");
      } else if (action === "comfy-guide") {
        await window.modelManager.openComfyGuide();
        appendLog("已打开 ComfyUI 下载说明页");
      } else if (action === "comfy-scan") {
        appendLog("扫描 ComfyUI…");
        const result = await window.modelManager.scanComfyUiSetup();
        appendLog(result.ok ? `已写入：${result.path}` : result.error || "扫描失败");
      } else if (action === "ffmpeg-install") {
        appendLog("开始安装 FFmpeg…");
        const result = await window.modelManager.installFfmpegSetup();
        if (result.needsManualFinish) {
          appendLog("已打开下载页，安装后请点「刷新状态」。");
        } else if (result.ok) {
          appendLog(
            result.message ||
              (result.path ? `FFmpeg 就绪：${result.path}` : "FFmpeg 安装完成")
          );
        } else {
          appendLog(result.error || "FFmpeg 安装失败");
        }
      }
      await refresh();
    } catch (error) {
      appendLog(`错误：${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  function setBusy(busy) {
    [
      els.ollamaInstall,
      els.ollamaStart,
      els.paiInstall,
      els.paiPick,
      els.paiStart,
      els.comfyGuide,
      els.comfyScan,
      els.ffmpegInstall,
      els.executorOpenclaw,
      els.executorPai,
      els.executorBrain,
      els.executorGotoAgent,
      els.refresh,
    ].forEach((btn) => {
      if (btn) btn.disabled = busy;
    });
  }

  return { init, refresh };
})();

window.SetupPanel = SetupPanel;

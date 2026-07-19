/**
 * Agent 主对话窗：打字办事（PAI）或答用法（内置帮助）。
 * 模型闲聊为可选子模式，不挡执行主路径。
 */
const AgentPanel = (() => {
  const els = {};
  let modelMode = false;
  let welcomed = false;
  let shutdownTimer = null;
  /** @type {{role:string, content:string}[]} */
  let history = [];
  let runtimeMode = "openclaw";
  let activeMoguTaskId = null;
  let streamBuffer = "";
  let unsubOpenclawTask = null;
  let unsubOpenclawState = null;
  /** @type {{ prompt: string, engine: string, workspace?: string, moguTaskId?: string }|null} */
  let lastCodingRetry = null;
  let brainBannerDismissed = false;

  const CMD_RE =
    /^(打开|列出|备份|删除|删掉|搜索|搜\s|抓取|出片|开始|同步|运行|启动|关闭|导入|下载|恢复|确认|移动|复制|写入|识别|检测|帮我打开|帮我删|帮我搜|请打开|请删除|请备份)/i;
  const HELP_RE =
    /怎么用|如何使用|教程|帮助|什么是|怎样|不会用|出片流程|创作台|环境中心|下载模型|mogu\s*ai|闲聊|问答|答疑|知识/i;

  const HELP_KB = [
    {
      keys: /创作台|出片|视频|工作流|剪映|shotcut|ffmpeg/,
      answer: [
        "🎬 **创作台用法**",
        "1. 侧栏点「创作」",
        "2. 点「+」选文生图 / 图生视频工作流（弹列表，不用开文件夹）",
        "3. 填写人物描述、动作描述，可选加参考照片",
        "4. 选 Shotcut（默认）或剪映，也可「添加其它工具」，点「执行」",
        "",
        "也可在本对话直接说：`列出工作流`、`打开 ComfyUI`。",
      ].join("\n"),
    },
    {
      keys: /模型|下载|ollama|导入|聊天模型/,
      answer: [
        "📦 **模型用法**",
        "1. 侧栏「模型」→「聊天模型」下载 GGUF",
        "2. 下载完成后会导入 Ollama（需引擎已启动）",
        "3. 需要本地模型闲聊时，点右上角「模型闲聊」",
        "",
        "办事（开软件、搜文件、备份）不需要先选模型，在本页直接打字即可。",
      ].join("\n"),
    },
    {
      keys: /环境|安装|pai|comfyui|依赖/,
      answer: [
        "🛠 **环境**",
        "侧栏「环境」可一键补齐：Ollama、PAI 引擎、ComfyUI（引导下载 + 扫描）。",
        "首页也有三灯：Ollama / PAI / ComfyUI。",
        "",
        "可直接说：`打开 ComfyUI`、`列出工作流`、`备份 PAI`。需要一键拉起服务时再说`开始工作`（启动时开始）。",
      ].join("\n"),
    },
    {
      keys: /删除|桌面|打开文件|搜文件|备份/,
      answer: [
        "⚡ **可直接打的指令示例**",
        "· `打开 ComfyUI`",
        "· `列出工作流`",
        "· `搜索 桌面` 或 `搜索 ROADMAP`",
        "· `备份 PAI`",
        "· `打开 资源管理器`",
        "· `删除 …`（L3，会弹确认，请写清路径）",
        "",
        "危险操作会二次确认；删文件请写完整路径，避免误删。",
      ].join("\n"),
    },
    {
      keys: /.*/,
      answer: [
        "MOGU AI Agent 能做两件事：",
        "",
        "1. **办事**：打开 ComfyUI、列工作流、搜文件、备份 PAI、打开/删除文件等（走 PAI，需确认的会弹窗）",
        "2. **答疑**：问「怎么用创作台」等；可在「设置 → Agent 引导模型」换成本机/联网模型让引导更聪明",
        "",
        "本地模型写文案/闲聊：点右上角「模型闲聊」。",
        "出片流水线：点「去创作台」。",
      ].join("\n"),
    },
  ];

  function init() {
    els.workspace = document.getElementById("agent-workspace");
    els.messages = document.getElementById("agent-messages");
    els.form = document.getElementById("agent-form");
    els.input = document.getElementById("agent-input");
    els.statusDot = document.getElementById("agent-status-dot");
    els.statusText = document.getElementById("agent-status-text");
    els.gotoStudio = document.getElementById("agent-goto-studio-btn");
    els.chatPicker = document.getElementById("chat-picker");
    els.chatWorkspace = document.getElementById("chat-workspace");
    els.runtimeMode = document.getElementById("agent-runtime-mode");
    els.executorPill = document.getElementById("agent-executor-pill");
    els.openclawState = document.getElementById("agent-openclaw-state");
    els.openclawConnectBtn = document.getElementById("agent-openclaw-connect-btn");
    els.openclawInstallBtn = document.getElementById("agent-openclaw-install-btn");
    els.taskCard = document.getElementById("agent-task-card");
    els.taskId = document.getElementById("agent-task-id");
    els.taskStatus = document.getElementById("agent-task-status");
    els.taskStream = document.getElementById("agent-task-stream");
    els.taskError = document.getElementById("agent-task-error");
    els.taskCancelBtn = document.getElementById("agent-task-cancel-btn");
    els.codingActions = document.getElementById("agent-coding-actions");
    els.codingRetryOther = document.getElementById("agent-coding-retry-other");
    els.brainBanner = document.getElementById("agent-brain-banner");
    els.brainBannerText = document.getElementById("agent-brain-banner-text");
    els.brainGotoApi = document.getElementById("agent-brain-goto-api");
    els.brainGotoLocal = document.getElementById("agent-brain-goto-local");
    els.brainBannerDismiss = document.getElementById("agent-brain-banner-dismiss");
    els.ocBanner = document.getElementById("agent-oc-banner");
    els.ocBannerText = document.getElementById("agent-oc-banner-text");
    els.ocBannerConnect = document.getElementById("agent-oc-banner-connect");
    els.ocBannerPai = document.getElementById("agent-oc-banner-pai");
    els.sessionsList = document.getElementById("agent-sessions-list");
    els.sessionsHint = document.getElementById("agent-sessions-hint");
    els.sessionsRefresh = document.getElementById("agent-sessions-refresh");

    els.gotoStudio?.addEventListener("click", () => window.AppRouter.navigate("studio"));
    document.getElementById("agent-goto-models-btn")?.addEventListener("click", () => {
      window.AppRouter.navigate("models", { modelsMode: "gate" });
    });
    els.shutdownStatus = document.getElementById("agent-shutdown-status");
    els.shutdownCancel = document.getElementById("agent-shutdown-cancel-btn");
    els.shutdownMinutes = document.getElementById("agent-shutdown-minutes");
    els.shutdownCustomBtn = document.getElementById("agent-shutdown-custom-btn");

    els.form?.addEventListener("submit", handleSubmit);
    els.shutdownCustomBtn?.addEventListener("click", scheduleCustomMinutes);
    els.runtimeMode?.addEventListener("change", onRuntimeModeChange);
    els.openclawConnectBtn?.addEventListener("click", connectOpenclaw);
    els.openclawInstallBtn?.addEventListener("click", openOpenclawInstallGuide);
    els.taskCancelBtn?.addEventListener("click", cancelActiveOpenclawTask);
    els.codingRetryOther?.addEventListener("click", retryCodingOtherEngine);
    els.brainGotoApi?.addEventListener("click", () => openBrainSettings("api"));
    els.brainGotoLocal?.addEventListener("click", () => openBrainSettings("local"));
    els.brainBannerDismiss?.addEventListener("click", () => {
      brainBannerDismissed = true;
      els.brainBanner?.classList.add("hidden");
    });
    els.ocBannerConnect?.addEventListener("click", connectOpenclaw);
    els.ocBannerPai?.addEventListener("click", switchToPaiCompat);
    els.sessionsRefresh?.addEventListener("click", () => refreshSessions());

    if (window.modelManager?.onOpenclawTask) {
      unsubOpenclawTask = window.modelManager.onOpenclawTask(onOpenclawTaskEvent);
    }
    if (window.modelManager?.onOpenclawState) {
      unsubOpenclawState = window.modelManager.onOpenclawState((status) => {
        paintOpenclawState(status);
      });
    }

    document.querySelectorAll("[data-agent-cmd]").forEach((button) => {
      button.addEventListener("click", async () => {
        const cmd = button.dataset.agentCmd || "";
        if (modelMode) exitModelMode();
        if (/怎么用/.test(cmd)) {
          els.input.value = cmd;
          await handleSubmit(new Event("submit"));
          return;
        }
        if (cmd === "搜索 ") {
          els.input.value = "搜索 ";
          els.input.focus();
          return;
        }
        await runAgentText(cmd);
      });
    });

    els.shutdownCancel?.addEventListener("click", cancelPendingShutdown);

    window.AppRouter.onPage("chat", onEnter);
  }

  function isModelMode() {
    return modelMode;
  }

  async function onEnter() {
    if (modelMode) {
      window.ChatUI?.onAgentHandoff?.();
      return;
    }
    showAgentMode();
    window.ButlerUI?.bindMessages?.(els.messages);
    await refreshStatus();
    await refreshBrainBanner();
    await refreshSessions();
    await refreshShutdownStatus();
    ensureWelcome();
    els.input?.focus();
  }

  function openBrainSettings(preferChannel) {
    try {
      if (preferChannel) sessionStorage.setItem("moguBrainPreferChannel", preferChannel);
      sessionStorage.setItem("moguFocusBrainSettings", "1");
    } catch {
      /* ignore */
    }
    window.AppRouter?.navigate?.("settings");
  }

  /**
   * @returns {Promise<{ ready: boolean, channel: string, reason: string }>}
   */
  async function getBrainSetupState() {
    try {
      const settings = await window.modelManager.getSettings();
      const channel = settings.agentBrainChannel || "builtin";
      if (channel === "builtin") {
        return {
          ready: false,
          channel,
          reason: "当前是「内置教程」，不会自动调用工具。请先配置联网 API 或本机 Ollama 模型。",
        };
      }
      if (channel === "api") {
        if (!settings.agentApiKeyConfigured) {
          return {
            ready: false,
            channel,
            reason: "已选联网 API，但还没有保存 API Key。请到设置填写密钥并保存。",
          };
        }
        if (!String(settings.agentApiBaseUrl || "").trim() || !String(settings.agentApiModel || "").trim()) {
          return {
            ready: false,
            channel,
            reason: "请补全 API Base URL 和模型名，保存后再试。",
          };
        }
        return { ready: true, channel, reason: "" };
      }
      if (channel === "local") {
        if (!String(settings.agentLocalModel || "").trim()) {
          return {
            ready: false,
            channel,
            reason: "已选本机模型，但尚未选择 Ollama 模型。请先到「模型」导入，再在设置里选中。",
          };
        }
        return { ready: true, channel, reason: "" };
      }
      return { ready: false, channel, reason: "未知大脑通道，请到设置重新选择。" };
    } catch (error) {
      return { ready: false, channel: "unknown", reason: error.message || "无法读取设置" };
    }
  }

  async function refreshBrainBanner() {
    if (!els.brainBanner) return;
    if (brainBannerDismissed) {
      els.brainBanner.classList.add("hidden");
      return;
    }
    const state = await getBrainSetupState();
    if (state.ready) {
      els.brainBanner.classList.add("hidden");
      return;
    }
    els.brainBanner.classList.remove("hidden");
    if (els.brainBannerText) {
      els.brainBannerText.textContent = state.reason;
    }
  }

  async function switchToPaiCompat() {
    runtimeMode = "pai";
    if (els.runtimeMode) els.runtimeMode.value = "pai";
    try {
      await window.modelManager.updateSettings({
        agentRuntimeMode: "pai",
        openclawEnabled: false,
      });
    } catch {
      /* ignore */
    }
    updateOcBanner({ connected: false });
    await refreshStatus();
    appendLocal("assistant", "已切换为 PAI（兼容）模式。需要 OpenClaw 时可随时在运行时下拉改回。");
  }

  function updateOcBanner(oc, brainReady = false) {
    if (!els.ocBanner) return;
    // 大脑已就绪时优先大脑调度，不再用 OpenClaw 未连接横幅打断
    const show =
      !brainReady &&
      runtimeMode === "openclaw" &&
      !(oc && (oc.connected === true || oc.state === "ready"));
    els.ocBanner.classList.toggle("hidden", !show);
    if (els.ocBannerText && show) {
      const state = oc?.state || oc?.lifecycle || "未连接";
      els.ocBannerText.textContent = `尚未连接 OpenClaw Gateway（${state}）。大脑未配置时连接后走 OpenClaw；也可改用 PAI 兼容。`;
    }
  }

  function paintExecutorPill(executor) {
    if (!els.executorPill) return;
    const map = {
      brain: "本次由：大脑",
      openclaw: "本次由：OpenClaw",
      pai: "本次由：PAI",
    };
    els.executorPill.textContent = map[executor] || "本次由：—";
    els.executorPill.classList.remove(
      "agent-executor-pill--brain",
      "agent-executor-pill--openclaw",
      "agent-executor-pill--pai"
    );
    if (executor) els.executorPill.classList.add(`agent-executor-pill--${executor}`);
  }

  function resolveExecutor(brainReady) {
    if (brainReady) return "brain";
    return runtimeMode === "openclaw" ? "openclaw" : "pai";
  }

  async function refreshSessions() {
    if (!els.sessionsList) return;
    if (runtimeMode !== "openclaw") {
      els.sessionsList.innerHTML = "";
      if (els.sessionsHint) {
        els.sessionsHint.textContent = "当前为 PAI 兼容模式；会话列表仅在 OpenClaw 下可用。";
      }
      return;
    }
    try {
      const result = await window.modelManager.listOpenclawSessions?.({ params: { limit: 40 } });
      const sessions = result?.sessions || [];
      if (!result?.ok) {
        els.sessionsList.innerHTML = "";
        if (els.sessionsHint) {
          els.sessionsHint.textContent =
            result?.message || "会话列表暂不可用（Gateway 未连接或方法不可用）。";
        }
        return;
      }
      if (!sessions.length) {
        els.sessionsList.innerHTML = `<li class="agent-sessions__empty">暂无会话</li>`;
        if (els.sessionsHint) els.sessionsHint.textContent = `方法：${result.method || "sessions.list"}`;
        return;
      }
      els.sessionsList.innerHTML = sessions
        .map((s) => {
          const key = s.sessionKey || s.key || s.id || s.sessionId || "—";
          const status = s.status || s.state || s.phase || "";
          const title = s.title || s.label || key;
          return `<li class="agent-sessions__item" title="${escapeHtml(String(key))}">
            <strong>${escapeHtml(String(title))}</strong>
            <span>${escapeHtml(String(status || key))}</span>
          </li>`;
        })
        .join("");
      if (els.sessionsHint) {
        els.sessionsHint.textContent = `${sessions.length} 个会话 · ${result.method || "sessions.list"}`;
      }
    } catch (error) {
      els.sessionsList.innerHTML = "";
      if (els.sessionsHint) els.sessionsHint.textContent = error.message || "列会话失败";
    }
  }

  function showAgentMode() {
    modelMode = false;
    els.workspace?.classList.remove("hidden");
    els.chatPicker?.classList.add("hidden");
    els.chatWorkspace?.classList.add("hidden");
  }

  function enterModelMode() {
    modelMode = true;
    els.workspace?.classList.add("hidden");
    window.ChatUI?.onAgentHandoff?.();
  }

  function exitModelMode() {
    showAgentMode();
    window.ButlerUI?.bindMessages?.(els.messages);
    els.input?.focus();
  }

  function ensureWelcome() {
    if (welcomed || !els.messages) return;
    if (els.messages.children.length) {
      welcomed = true;
      return;
    }
    appendLocal(
      "assistant",
      [
        "欢迎使用 MOGU AI。",
        "",
        "【请先做这一步】配置大脑——否则软件不知道怎么自动办事。",
        "1. 点上方橙色条「配置联网 API」（推荐），或「配置本机模型」",
        "2. 保存后回到对话，直接用自然语言下指令",
        "",
        "大脑 = 听懂你的话并调度；本机 / 编程 / 出片都是工具（Key 只填大脑一次）。",
        "未配置前只能看内置说明，不会自动调用工具。",
      ].join("\n")
    );
    welcomed = true;
  }

  function classify(text) {
    const t = String(text || "").trim();
    if (!t) return "empty";
    if (HELP_RE.test(t) && !CMD_RE.test(t)) return "help";
    if (CMD_RE.test(t)) return "command";
    if (/comfyui|工作流|\bpai\b/i.test(t) && /(打开|列出|备份|删除|搜索|同步)/.test(t)) {
      return "command";
    }
    if (HELP_RE.test(t)) return "help";
    // 短句且像指令 → 办事；否则当用法问答
    if (t.length <= 48 && /打开|列出|备份|删除|搜索|出片|启动/.test(t)) return "command";
    return "help";
  }

  function answerHelp(text) {
    const hit = HELP_KB.find((item) => item.keys.test(text));
    return hit?.answer || HELP_KB[HELP_KB.length - 1].answer;
  }

  async function handleSubmit(event) {
    event?.preventDefault?.();
    const text = els.input?.value?.trim() || "";
    if (!text) return;
    els.input.value = "";
    await runAgentText(text);
  }

  async function onRuntimeModeChange() {
    runtimeMode = els.runtimeMode?.value || "pai";
    try {
      await window.modelManager.updateSettings({
        agentRuntimeMode: runtimeMode,
        openclawEnabled: runtimeMode === "openclaw",
      });
    } catch {
      // ignore
    }
    await refreshStatus();
  }

  function showOpenclawInstallCta(show) {
    els.openclawInstallBtn?.classList.toggle("hidden", !show);
  }

  async function openOpenclawInstallGuide() {
    try {
      const guide = await window.modelManager.getOpenclawInstallGuide?.();
      const hint =
        guide?.installHint ||
        "请先安装 OpenClaw Gateway。安装后点「连接」会自动拉起并连上。";
      appendLocal(
        "assistant",
        `${hint}\n\n安装步骤也可在侧栏「OpenClaw」页查看。正在打开官方安装文档…`
      );
      await window.modelManager.openOpenclawInstallDocs?.();
      window.AppRouter?.navigate?.("openclaw");
    } catch (error) {
      appendLocal("assistant", `打开安装引导失败：${error.message}`);
    }
  }

  function needsOpenclawInstallHint(message = "") {
    return /未检测|未找到|请先安装 OpenClaw|openclaw CLI|自动启动失败|gateway_not_running|未运行|ECONNREFUSED|超时/i.test(
      String(message)
    );
  }

  async function connectOpenclaw() {
    try {
      els.openclawConnectBtn && (els.openclawConnectBtn.disabled = true);
      showOpenclawInstallCta(false);
      appendLocal("assistant", "正在连接 OpenClaw Gateway（若未运行会尝试自动启动）…");
      const status = await window.modelManager.connectOpenclaw?.({});
      paintOpenclawState(status);
      if (status?.connected) {
        showOpenclawInstallCta(false);
        if (els.runtimeMode) {
          els.runtimeMode.value = "openclaw";
          runtimeMode = "openclaw";
          await window.modelManager.updateSettings?.({
            agentRuntimeMode: "openclaw",
            openclawEnabled: true,
          });
        }
        updateOcBanner(status);
        await refreshSessions();
        appendLocal("assistant", "已连接 OpenClaw。正在打开「添加模型」…");
        await refreshStatus();
        window.AppRouter?.navigate?.("models", { modelsMode: "gate" });
        return;
      }
      appendLocal("assistant", `连接状态：${status?.state || "unknown"}`);
      await refreshStatus();
    } catch (error) {
      const msg = error.message || "";
      const needsInstall = needsOpenclawInstallHint(msg);
      if (needsInstall) {
        showOpenclawInstallCta(true);
        appendLocal(
          "assistant",
          `连接 OpenClaw 失败：${msg}\n\n请先安装 OpenClaw Gateway。装好后点「连接」会自动拉起并连上。\n点右上角「请安装 OpenClaw」可打开官方文档与安装说明。\n你也可以先继续用「PAI（兼容）」办事。`
        );
      } else {
        appendLocal("assistant", `连接 OpenClaw 失败：${msg}`);
      }
    } finally {
      if (els.openclawConnectBtn) els.openclawConnectBtn.disabled = false;
    }
  }

  function paintOpenclawState(status) {
    if (status && status.state !== "probing") {
      updateOcBanner(status);
    }
    if (!els.openclawState) return;
    const state = status?.state || "disconnected";
    // Ignore transient probe flicker if it ever leaks through.
    if (state === "probing") return;
    const ver = status?.hello?.serverVersion ? ` · ${status.hello.serverVersion}` : "";
    const label = status?.connected ? "connected" : state;
    const next = `OpenClaw: ${label}${ver}`;
    if (els.openclawState.textContent === next) return;
    els.openclawState.textContent = next;
  }

  function showTaskCard(partial = {}) {
    els.taskCard?.classList.remove("hidden");
    if (partial.moguTaskId && els.taskId) {
      activeMoguTaskId = partial.moguTaskId;
      els.taskId.textContent = partial.moguTaskId;
    }
    if (partial.status && els.taskStatus) els.taskStatus.textContent = partial.status;
    if (partial.streamText != null && els.taskStream) els.taskStream.textContent = partial.streamText;
    if (partial.error != null && els.taskError) els.taskError.textContent = partial.error || "";
  }

  function onOpenclawTaskEvent(payload) {
    if (!payload) return;
    if (payload.moguTaskId) activeMoguTaskId = payload.moguTaskId;
    if (payload.streamText) streamBuffer = payload.streamText;
    else if (payload.kind === "agent_delta" && payload.text) {
      streamBuffer += payload.text;
    }
    showTaskCard({
      moguTaskId: payload.moguTaskId || activeMoguTaskId,
      status: payload.status || "running",
      streamText: streamBuffer,
      error: payload.error || "",
    });
    if (["succeeded", "failed", "cancelled", "timed_out"].includes(payload.status) && streamBuffer) {
      replaceTempAssistant(streamBuffer);
      history.push({ role: "assistant", content: streamBuffer });
    }
  }

  async function cancelActiveOpenclawTask() {
    if (!activeMoguTaskId) {
      appendLocal("assistant", "当前没有可取消的 OpenClaw 任务。");
      return;
    }
    try {
      const result = await window.modelManager.openclawAbort?.({ moguTaskId: activeMoguTaskId });
      if (result?.needsConfirmation) {
        appendLocal("assistant", result.message || "缺少精确 ID，无法安全取消。");
        return;
      }
      showTaskCard({ moguTaskId: activeMoguTaskId, status: result?.ok ? "cancelled" : "failed", error: result?.error || "" });
      appendLocal("assistant", result?.ok ? "已精确取消当前任务。" : `取消失败：${result?.error || "未知错误"}`);
    } catch (error) {
      appendLocal("assistant", `取消失败：${error.message}`);
    }
  }

  async function runOpenclawText(text) {
    appendLocal("user", text);
    history.push({ role: "user", content: text });
    streamBuffer = "";
    showTaskCard({ moguTaskId: "…", status: "queued", streamText: "", error: "" });
    appendLocal("assistant", "OpenClaw 处理中…", { temp: true });
    setFormBusy(true);
    try {
      const result = await window.modelManager.openclawSend?.({ text });
      if (result?.permissionDenied) {
        replaceTempAssistant(`⛔ ${result.message || "权限已拒绝"}`);
        showTaskCard({
          moguTaskId: activeMoguTaskId || "—",
          status: "failed",
          error: result.message || result.reason || "permission_denied",
        });
        return;
      }
      if (result?.usePai) {
        replaceTempAssistant(`${result.message}\n\n已按策略切换到 PAI（请求尚未被 Gateway 接受）。`);
        if (window.ButlerUI?.runCommand) {
          await window.ButlerUI.runCommand(text);
        }
        return;
      }
      if (result?.accepted === false && result?.ok === false && result?.reason === "gateway_accepted_no_auto_fallback") {
        replaceTempAssistant(result.message || "等待超时；请求已接受，不会降级重发。");
        showTaskCard({
          moguTaskId: result.moguTaskId,
          status: "timed_out",
          error: result.message || "",
        });
        return;
      }
      if (result?.ok === false && result?.accepted) {
        replaceTempAssistant(result.message || "Gateway 已接受但未完成；可查询/重连/取消，不会自动重发。");
        showTaskCard({
          moguTaskId: result.moguTaskId,
          status: "timed_out",
          error: result.message || "",
        });
        return;
      }
      if (result?.moguTaskId) {
        showTaskCard({
          moguTaskId: result.moguTaskId,
          status: "running",
          streamText: streamBuffer,
        });
      }
      // Stream/final text arrives via openclaw-task events.
    } catch (error) {
      replaceTempAssistant(`OpenClaw 失败：${error.message}`);
      showTaskCard({
        moguTaskId: activeMoguTaskId || "—",
        status: "failed",
        error: error.message,
      });
    } finally {
      setFormBusy(false);
      els.input?.focus();
    }
  }

  function mapTextToSkill(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    if (/^列出工作流/.test(t)) return { skillId: "mogu.comfy", op: "list", args: {} };
    if (/^(确认出片|出片)/.test(t) || /工作流/.test(t) && /出片|生成/.test(t)) {
      return { skillId: "mogu.comfy", op: "run", args: { command: t } };
    }
    if (/^打开\s*/.test(t)) return { skillId: "mogu.pc", op: "open", args: { command: t } };
    if (/^搜索\s*/.test(t)) return { skillId: "mogu.pc", op: "search", args: { command: t } };
    if (/备份\s*PAI|备份项目/.test(t)) return { skillId: "mogu.pc", op: "backup", args: {} };
    if (/拼接|合成视频|一键拼接/.test(t)) return { skillId: "mogu.media", op: "preflight", args: {} };
    if (/^编程状态|^编程引擎|^coding\s*status/i.test(t)) {
      return { skillId: "mogu.coding", op: "status", args: {} };
    }
    const codingRun = t.match(
      /^(?:用\s*)?(codex|trae|trae-agent)\s*(?:在\s*)?(.+?)\s*(?:里|中)?\s*(?:改|修|写|实现|编程)[:：\s]+(.+)$/i
    );
    if (codingRun) {
      const eng = /trae/i.test(codingRun[1]) ? "trae" : "codex";
      return {
        skillId: "mogu.coding",
        op: "run",
        args: { engine: eng, workspace: codingRun[2].trim(), prompt: codingRun[3].trim() },
      };
    }
    if (/^(?:编程|改代码|写代码|修bug|修\s*bug)[:：\s]+(.+)$/i.test(t)) {
      const prompt = t.replace(/^(?:编程|改代码|写代码|修bug|修\s*bug)[:：\s]+/i, "").trim();
      return { skillId: "mogu.coding", op: "run", args: { prompt } };
    }
    return null;
  }

  async function trySkillInvoke(text) {
    const mapped = mapTextToSkill(text);
    if (!mapped || !window.modelManager?.invokeSkill) return null;
    appendLocal("user", text);
    history.push({ role: "user", content: text });
    appendLocal("assistant", `Skill ${mapped.skillId}.${mapped.op} 执行中…`, { temp: true });
    const result = await window.modelManager.invokeSkill(mapped);
    if (result?.permissionDenied) {
      replaceTempAssistant(`⛔ ${result.error || result.message || "权限已拒绝"}`);
      return result;
    }
    if (result?.moguTaskId || mapped.skillId === "mogu.coding") {
      showTaskCard({
        moguTaskId: result.moguTaskId || "—",
        status: result.ok === false ? "failed" : result.op === "status" ? "idle" : "succeeded",
        streamText: result.log || result.trajectorySummary || "",
        error: result.error || "",
      });
    }
    if (mapped.skillId === "mogu.coding" && mapped.op === "run") {
      lastCodingRetry = {
        prompt: mapped.args?.prompt || "",
        engine: result?.engine || mapped.args?.engine || "codex",
        workspace: result?.workspace || mapped.args?.workspace,
        moguTaskId: result?.moguTaskId,
      };
      els.codingActions?.classList.toggle("hidden", !(result?.canRetryOtherEngine || result?.ok === false));
    } else {
      els.codingActions?.classList.add("hidden");
    }
    replaceTempAssistant(
      result?.ok === false
        ? `Skill 失败：${result.error || result.message || JSON.stringify(result.preflight || {})}${
            result?.canRetryOtherEngine ? `\n可点任务卡「换引擎重试」改用 ${result.altEngine || "另一引擎"}。` : ""
          }`
        : `Skill 完成（${mapped.skillId}.${mapped.op}）${result.moguTaskId ? `\n任务 ${result.moguTaskId}` : ""}\n${summarizeSkillResult(result)}`
    );
    return result;
  }

  async function retryCodingOtherEngine() {
    if (!lastCodingRetry?.prompt) {
      appendLocal("assistant", "没有可重试的编程任务。");
      return;
    }
    const next = /trae/i.test(lastCodingRetry.engine) ? "codex" : "trae";
    setFormBusy(true);
    try {
      appendLocal("assistant", `正在用 ${next} 重试…`, { temp: true });
      const result = await window.modelManager.invokeSkill({
        skillId: "mogu.coding",
        op: "retry",
        args: {
          engine: lastCodingRetry.engine,
          toEngine: next,
          prompt: lastCodingRetry.prompt,
          workspace: lastCodingRetry.workspace,
        },
      });
      lastCodingRetry.engine = result?.engine || next;
      lastCodingRetry.moguTaskId = result?.moguTaskId;
      showTaskCard({
        moguTaskId: result?.moguTaskId || "—",
        status: result?.ok === false ? "failed" : "succeeded",
        streamText: result?.log || "",
        error: result?.error || "",
      });
      els.codingActions?.classList.toggle("hidden", !(result?.canRetryOtherEngine || result?.ok === false));
      replaceTempAssistant(
        result?.ok === false
          ? `换引擎重试失败：${result.error || ""}`
          : `换引擎重试完成（${result?.engine || next}）\n${summarizeSkillResult(result)}`
      );
    } catch (error) {
      replaceTempAssistant(`换引擎重试异常：${error.message}`);
    } finally {
      setFormBusy(false);
    }
  }

  function summarizeSkillResult(result) {
    if (!result || typeof result !== "object") return "";
    if (result.engines) {
      const c = result.engines.codex;
      const t = result.engines.trae;
      return [
        `Codex: ${c?.installed ? "就绪" : "未安装"} ${c?.version || ""}`,
        `trae-agent: ${t?.installed ? "就绪" : "未安装"} ${t?.message || ""}`,
        result.workspace ? `工作区：${result.workspace}` : "工作区：未设置（设置 → 编程双引擎）",
      ].join("\n");
    }
    if (result.catalog) return `工作流条目：${JSON.stringify(result.catalog).slice(0, 400)}`;
    if (result.log) return String(result.log).slice(0, 800);
    if (result.trajectorySummary) return `轨迹：\n${String(result.trajectorySummary).slice(0, 800)}`;
    if (result.command) return `命令：${result.command}`;
    if (result.outputPaths?.length) return `输出：${result.outputPaths.join(", ")}`;
    if (result.provenance && typeof result.provenance === "object") {
      return `provenance：${JSON.stringify(result.provenance).slice(0, 400)}`;
    }
    if (result.result) return JSON.stringify(result.result).slice(0, 400);
    return "";
  }

  async function runAgentText(text) {
    const brainState = await getBrainSetupState();
    await refreshBrainBanner();

    // 未配大脑：先引导去设置；说明类问题仍可用内置教程
    if (!brainState.ready) {
      if (/怎么用|如何使用|教程|帮助|什么是|怎样|不会用/i.test(text)) {
        await answerWithBrain(text);
        return;
      }
      appendLocal("user", text);
      history.push({ role: "user", content: text });
      appendLocal(
        "assistant",
        [
          "还不能自动执行这条指令——请先配置大脑。",
          "",
          brainState.reason,
          "",
          "点上方橙色条：「配置联网 API」（推荐）或「配置本机模型」。",
          "保存后回到对话再发送。问用法可以说「怎么用创作台」。",
        ].join("\n")
      );
      brainBannerDismissed = false;
      await refreshBrainBanner();
      return;
    }

    // 大脑模式（API / 本机）：直接输入指令 → 自动选工具执行
    if (
      (brainState.channel === "api" || brainState.channel === "local") &&
      typeof window.modelManager.agentBrainAct === "function"
    ) {
      await runBrainAct(text);
      await refreshStatus();
      return;
    }

    const kind = classify(text);
    if (kind === "help") {
      await answerWithBrain(text);
      return;
    }

    // 内置教程模式：精确指令仍可走 Skill；编程双 Runtime 均可
    const skillMapped = mapTextToSkill(text);
    if (skillMapped && (runtimeMode !== "openclaw" || skillMapped.skillId === "mogu.coding")) {
      setFormBusy(true);
      try {
        const skillResult = await trySkillInvoke(text);
        if (skillResult) {
          await refreshStatus();
          return;
        }
      } finally {
        setFormBusy(false);
        els.input?.focus();
      }
    }

    if (runtimeMode === "openclaw") {
      await runOpenclawText(text);
      await refreshStatus();
      return;
    }

    if (!window.ButlerUI?.runCommand) {
      appendLocal("user", text);
      appendLocal("assistant", "执行引擎未就绪。请到「环境」检查 PAI，或打开「高级控制台」。");
      return;
    }

    window.ButlerUI.bindMessages?.(els.messages);
    setFormBusy(true);
    try {
      await window.ButlerUI.runCommand(text);
    } finally {
      setFormBusy(false);
      els.input?.focus();
    }
    await refreshStatus();
  }

  async function runBrainAct(text) {
    appendLocal("user", text);
    history.push({ role: "user", content: text });
    setFormBusy(true);
    appendLocal("assistant", "大脑调度中…", { temp: true });
    let unsub = null;
    try {
      if (window.modelManager.onBrainProgress) {
        unsub = window.modelManager.onBrainProgress((p) => {
          if (p?.phase === "tool") {
            showTaskCard({
              moguTaskId: p.tool || "brain",
              status: "running",
              streamText: `调用工具 ${p.tool}…`,
            });
          }
        });
      }
      const result = await window.modelManager.agentBrainAct({
        text,
        history: history.slice(0, -1),
      });
      const steps = result?.steps || [];
      if (steps.length) {
        const last = steps[steps.length - 1];
        showTaskCard({
          moguTaskId: last.moguTaskId || last.tool || "brain",
          status: steps.every((s) => s.ok) ? "succeeded" : "failed",
          streamText: steps
            .map((s) => `${s.tool}.${s.op} → ${s.ok ? "ok" : s.error || "fail"}`)
            .join("\n"),
          error: steps.find((s) => !s.ok)?.error || "",
        });
        const codingFail = steps.find((s) => s.skillId === "mogu.coding" && !s.ok);
        if (codingFail) {
          lastCodingRetry = {
            prompt: text,
            engine: "codex",
            moguTaskId: codingFail.moguTaskId,
          };
          els.codingActions?.classList.remove("hidden");
        }
      }
      const reply =
        result?.content ||
        (steps.length
          ? `已调度 ${steps.length} 个工具步骤。`
          : "大脑未返回内容。请检查 API Key / 模型。");
      const stamped = `【本次由：大脑】\n${reply}`;
      replaceTempAssistant(stamped);
      history.push({ role: "assistant", content: reply });
      if (history.length > 20) history = history.slice(-20);
      paintExecutorPill("brain");
      window.AppCore?.setStatus?.(
        result?.provider === "api" ? "大脑（API）已调度" : "大脑（本机）已调度"
      );
    } catch (error) {
      replaceTempAssistant(
        `大脑调度失败：${error.message}\n\n请到设置确认「大脑通道」为联网 API 或本机模型，并已填写密钥。也可先用「编程状态」等精确指令。`
      );
      history.push({ role: "assistant", content: error.message });
      window.AppCore?.setStatus?.(`大脑失败：${error.message}`);
    } finally {
      if (typeof unsub === "function") unsub();
      setFormBusy(false);
      els.input?.focus();
    }
  }

  async function scheduleCustomMinutes() {
    const minutes = Number(els.shutdownMinutes?.value);
    if (!Number.isFinite(minutes) || minutes < 1) {
      window.AppCore?.setStatus?.("请输入至少 1 分钟");
      return;
    }
    if (minutes > 1440) {
      window.AppCore?.setStatus?.("最长 24 小时（1440 分钟）");
      return;
    }
    const seconds = Math.round(minutes * 60);
    const label =
      minutes >= 60 && minutes % 60 === 0
        ? `${minutes / 60} 小时后`
        : `${minutes} 分钟后`;
    if (!window.confirm(`确定${label}自动关机？\n可随时点「取消关机」中止。`)) {
      return;
    }
    try {
      const status = await window.modelManager.scheduleShutdown({
        seconds,
        label,
        preset: "custom",
      });
      appendLocal("assistant", `已设置定时关机：${status.label || label}。到点将关闭电脑；可点「取消关机」。`);
      window.AppCore?.setStatus?.(`已设置${label}关机`);
      await refreshShutdownStatus();
    } catch (error) {
      appendLocal("assistant", `设置关机失败：${error.message}`);
      window.AppCore?.setStatus?.(error.message);
    }
  }

  async function cancelPendingShutdown() {
    try {
      await window.modelManager.cancelShutdown();
      appendLocal("assistant", "已取消定时关机。");
      window.AppCore?.setStatus?.("已取消关机");
      await refreshShutdownStatus();
    } catch (error) {
      appendLocal("assistant", `取消失败：${error.message}`);
    }
  }

  async function refreshShutdownStatus() {
    if (!els.shutdownStatus || !window.modelManager.getShutdownStatus) return;
    try {
      const status = await window.modelManager.getShutdownStatus();
      if (!status.pending) {
        els.shutdownStatus.textContent = "";
        if (shutdownTimer) {
          clearInterval(shutdownTimer);
          shutdownTimer = null;
        }
        return;
      }
      const paint = () => {
        const left = Math.max(0, Math.ceil((status.at - Date.now()) / 1000));
        const m = Math.floor(left / 60);
        const s = left % 60;
        els.shutdownStatus.textContent = `将在 ${m}分${String(s).padStart(2, "0")}秒 后关机`;
        if (left <= 0 && shutdownTimer) {
          clearInterval(shutdownTimer);
          shutdownTimer = null;
        }
      };
      paint();
      if (shutdownTimer) clearInterval(shutdownTimer);
      shutdownTimer = setInterval(async () => {
        const latest = await window.modelManager.getShutdownStatus();
        if (!latest.pending) {
          els.shutdownStatus.textContent = "";
          clearInterval(shutdownTimer);
          shutdownTimer = null;
          return;
        }
        const left = Math.max(0, Math.ceil((latest.at - Date.now()) / 1000));
        const m = Math.floor(left / 60);
        const s = left % 60;
        els.shutdownStatus.textContent = `将在 ${m}分${String(s).padStart(2, "0")}秒 后关机`;
      }, 1000);
    } catch {
      els.shutdownStatus.textContent = "";
    }
  }

  async function answerWithBrain(text) {
    appendLocal("user", text);
    history.push({ role: "user", content: text });
    setFormBusy(true);
    appendLocal("assistant", "思考中…", { temp: true });
    try {
      const settings = await window.modelManager.getSettings();
      const channel = settings.agentBrainChannel || "builtin";
      if (channel === "builtin" || !window.modelManager.agentBrainChat) {
        const reply = answerHelp(text);
        replaceTempAssistant(reply);
        history.push({ role: "assistant", content: reply });
        window.AppCore?.setStatus?.("已用内置教程回答");
        return;
      }

      const result = await window.modelManager.agentBrainChat({
        text,
        history: history.slice(0, -1),
      });
      const reply = result?.content || answerHelp(text);
      replaceTempAssistant(reply);
      history.push({ role: "assistant", content: reply });
      if (history.length > 20) history = history.slice(-20);
      window.AppCore?.setStatus?.(
        result?.provider === "api" ? "已用联网模型回答" : "已用本地模型回答"
      );
    } catch (error) {
      const fallback = `${answerHelp(text)}\n\n（模型引导失败：${error.message}；已回退内置教程。可在设置里检查 Agent 引导模型。）`;
      replaceTempAssistant(fallback);
      history.push({ role: "assistant", content: fallback });
      window.AppCore?.setStatus?.(`引导失败：${error.message}`);
    } finally {
      setFormBusy(false);
      els.input?.focus();
    }
  }

  function setFormBusy(busy) {
    if (els.input) els.input.disabled = busy;
    const submit = els.form?.querySelector('button[type="submit"]');
    if (submit) submit.disabled = busy;
  }

  function appendLocal(role, text, options = {}) {
    if (!els.messages) return;
    const item = document.createElement("article");
    item.className = `butler-message butler-message--${role}`;
    if (options.temp) item.dataset.temp = "1";
    const body = escapeHtml(text).replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    item.innerHTML = `<div class="butler-message__body">${body}</div>`;
    els.messages.appendChild(item);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function replaceTempAssistant(text) {
    const temp = els.messages?.querySelector('.butler-message--assistant[data-temp="1"]');
    if (!temp) {
      appendLocal("assistant", text);
      return;
    }
    const body = escapeHtml(text).replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    temp.removeAttribute("data-temp");
    const bodyEl = temp.querySelector(".butler-message__body");
    if (bodyEl) bodyEl.innerHTML = body;
    else temp.innerHTML = `<div class="butler-message__body">${body}</div>`;
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  async function refreshStatus() {
    try {
      const settings = await window.modelManager.getSettings();
      runtimeMode = settings.agentRuntimeMode === "openclaw" ? "openclaw" : "pai";
      if (els.runtimeMode && els.runtimeMode.value !== runtimeMode) {
        els.runtimeMode.value = runtimeMode;
      }

      const oc = settings.openclaw || (await window.modelManager.getOpenclawStatus?.());
      paintOpenclawState(oc);

      const brain =
        settings.agentBrainChannel === "api"
          ? `联网 · ${settings.agentApiModel || "API"}`
          : settings.agentBrainChannel === "local"
            ? `本机 · ${settings.agentLocalModel || "Ollama"}`
            : "内置教程";

      const brainSetup = await getBrainSetupState();
      const brainLabel = brainSetup.ready
        ? brain
        : "大脑未配置（请先设 API 或本机模型）";
      const executor = resolveExecutor(brainSetup.ready);
      paintExecutorPill(executor);
      updateOcBanner(oc, brainSetup.ready);

      if (brainSetup.ready) {
        setStatus("online", `大脑优先 · ${brainLabel}（兜底：${runtimeMode === "openclaw" ? "OpenClaw" : "PAI"}）`);
        await refreshBrainBanner();
        return;
      }

      if (runtimeMode === "openclaw") {
        if (oc?.connected) {
          setStatus("online", `OpenClaw 就绪 · ${brainLabel}`);
        } else {
          setStatus("stopped", `OpenClaw ${oc?.state || "未连接"} · ${brainLabel}`);
        }
        await refreshBrainBanner();
        return;
      }

      const status = await window.modelManager.getPaiStatus();
      if (!status.installed) {
        setStatus("offline", `${brainLabel} · PAI 未就绪`);
      } else if (status.running) {
        setStatus("online", `PAI 就绪 · ${brainLabel}`);
      } else {
        setStatus("stopped", `${brainLabel} · PAI 未运行`);
      }
      await refreshBrainBanner();
    } catch (error) {
      setStatus("offline", `状态检测失败：${error.message}`);
    }
  }

  function setStatus(state, text) {
    if (els.statusText) els.statusText.textContent = text;
    els.statusDot?.classList.remove(
      "butler-status__dot--online",
      "butler-status__dot--stopped",
      "butler-status__dot--offline"
    );
    if (state === "online") els.statusDot?.classList.add("butler-status__dot--online");
    else if (state === "stopped") els.statusDot?.classList.add("butler-status__dot--stopped");
    else els.statusDot?.classList.add("butler-status__dot--offline");
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { init, isModelMode, onEnter, enterModelMode, exitModelMode };
})();

window.AgentPanel = AgentPanel;

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
  let runtimeMode = "pai";
  let activeMoguTaskId = null;
  let streamBuffer = "";
  let unsubOpenclawTask = null;
  let unsubOpenclawState = null;

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
    els.openclawState = document.getElementById("agent-openclaw-state");
    els.openclawConnectBtn = document.getElementById("agent-openclaw-connect-btn");
    els.openclawInstallBtn = document.getElementById("agent-openclaw-install-btn");
    els.taskCard = document.getElementById("agent-task-card");
    els.taskId = document.getElementById("agent-task-id");
    els.taskStatus = document.getElementById("agent-task-status");
    els.taskStream = document.getElementById("agent-task-stream");
    els.taskError = document.getElementById("agent-task-error");
    els.taskCancelBtn = document.getElementById("agent-task-cancel-btn");

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
    await refreshShutdownStatus();
    ensureWelcome();
    els.input?.focus();
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
        "你好，我是 MOGU AI Agent。",
        "",
        "直接打字即可，例如：",
        "· 打开 ComfyUI",
        "· 列出工作流",
        "· 搜索 桌面",
        "· 备份 PAI",
        "· 怎么用创作台",
        "",
        "删除文件等危险操作会二次确认。",
        "还没有模型？点右上角「去添加模型」。添好后可在设置里把引导换成更聪明的本机/联网模型。",
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

  async function runAgentText(text) {
    const kind = classify(text);
    if (kind === "help") {
      await answerWithBrain(text);
      return;
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

      if (runtimeMode === "openclaw") {
        if (oc?.connected) {
          setStatus("online", `OpenClaw 就绪 · 引导：${brain}`);
        } else {
          setStatus("stopped", `OpenClaw ${oc?.state || "未连接"} · 引导：${brain}`);
        }
        return;
      }

      const status = await window.modelManager.getPaiStatus();
      if (!status.installed) {
        setStatus("offline", `引导：${brain} · PAI 未就绪（问用法仍可用）`);
        return;
      }
      if (status.running) {
        setStatus("online", `PAI 就绪 · 引导：${brain}`);
        return;
      }
      setStatus("stopped", `引导：${brain} · PAI 未运行（发指令会自动连）`);
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

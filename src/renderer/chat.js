const ChatUI = (() => {
  const els = {};
  let activeModel = null;
  let activeSessionId = null;
  let isGenerating = false;
  let prompts = [];
  let pendingModel = null;
  let stickToBottom = true;

  function init() {
    els.picker = document.getElementById("chat-picker");
    els.workspace = document.getElementById("chat-workspace");
    els.readyModels = document.getElementById("chat-ready-models");
    els.gotoModelsBtn = document.getElementById("chat-goto-models-btn");
    els.changeModelBtn = document.getElementById("chat-change-model-btn");
    els.sessionList = document.getElementById("chat-session-list");
    els.sessionSearch = document.getElementById("chat-session-search");
    els.messages = document.getElementById("chat-messages");
    els.form = document.getElementById("chat-form");
    els.input = document.getElementById("chat-input");
    els.title = document.getElementById("chat-title");
    els.subtitle = document.getElementById("chat-subtitle");
    els.tokenStats = document.getElementById("chat-token-stats");
    els.promptSelect = document.getElementById("chat-prompt-select");
    els.newSessionBtn = document.getElementById("chat-new-session-btn");
    els.stopBtn = document.getElementById("chat-stop-btn");
    els.regenerateBtn = document.getElementById("chat-regenerate-btn");
    els.exportBtn = document.getElementById("chat-export-btn");

    els.newSessionBtn.addEventListener("click", () => createSession());
    els.sessionSearch.addEventListener("input", () => loadSessions());
    els.form.addEventListener("submit", handleSubmit);
    els.stopBtn.addEventListener("click", handleStop);
    els.regenerateBtn.addEventListener("click", handleRegenerate);
    els.promptSelect.addEventListener("change", handlePromptChange);
    els.messages.addEventListener("click", handleMessageActions);
    els.messages.addEventListener("scroll", () => {
      const el = els.messages;
      stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    });
    els.exportBtn.addEventListener("click", handleExport);
    els.gotoModelsBtn.addEventListener("click", () => window.AppRouter.navigate("models"));
    els.changeModelBtn.addEventListener("click", () => showPicker());

    window.AppRouter.onPage("chat", onChatPageEnter);

    window.modelManager.onOllamaChatChunk((payload) => {
      if (payload.sessionId !== activeSessionId) return;
      const bubble = els.messages.querySelector(".chat-message--assistant.is-streaming .chat-message__body");
      if (bubble) {
        bubble.innerHTML = window.ChatMarkdown.renderMarkdown(payload.content);
        scrollToBottom();
      }
    });
  }

  function onChatPageEnter() {
    if (pendingModel) {
      const model = pendingModel;
      pendingModel = null;
      open(model);
      return;
    }
    showPicker();
    renderReadyModels(window.AppCore?.getCachedModels?.() || []);
  }

  function enterWithModel(model) {
    if (!model?.ollamaImported) {
      return false;
    }
    pendingModel = model;
    window.AppRouter.navigate("chat");
    return true;
  }

  function showPicker() {
    activeModel = null;
    activeSessionId = null;
    els.picker.classList.remove("hidden");
    els.workspace.classList.add("hidden");
  }

  function showWorkspace() {
    els.picker.classList.add("hidden");
    els.workspace.classList.remove("hidden");
  }

  function renderReadyModels(models) {
    const ready = (models || []).filter((item) => item.ollamaImported);
    if (!ready.length) {
      els.readyModels.innerHTML = `<div class="empty-state">还没有可聊天的模型。请先到「模型仓库」下载并导入。</div>`;
      return;
    }

    els.readyModels.innerHTML = ready
      .map(
        (model) => `
        <button type="button" class="chat-ready-card" data-model-id="${model.id}">
          <strong>${escapeText(model.name)}</strong>
          <span>${model.size} · 点击开始聊天</span>
        </button>
      `
      )
      .join("");

    els.readyModels.querySelectorAll("[data-model-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const model = ready.find((item) => item.id === button.dataset.modelId);
        if (model) {
          open(model);
        }
      });
    });
  }

  async function open(model) {
    if (!model) {
      showPicker();
      return;
    }

    activeModel = model;
    showWorkspace();
    els.title.textContent = model.name;
    els.subtitle.textContent = `当前模型：${model.name}`;
    prompts = await window.modelManager.listPrompts();
    renderPromptOptions();
    await loadSessions();
    els.input.focus();
  }

  async function loadSessions() {
    if (!activeModel) {
      return;
    }

    const query = els.sessionSearch.value.trim();
    const sessions = query
      ? await window.modelManager.searchChatSessions({ query, modelId: activeModel.id })
      : await window.modelManager.listChatSessions(activeModel.id);

    els.sessionList.innerHTML = sessions.length
      ? sessions
          .map(
            (session) => `
          <div class="chat-session-item ${session.id === activeSessionId ? "is-active" : ""}" data-session-id="${session.id}">
            <button type="button" class="chat-session-item__main" data-session-id="${session.id}">
              <strong>${escapeText(session.title)}</strong>
              <span>${session.messageCount} 条消息</span>
            </button>
            <div class="chat-session-item__actions">
              <button type="button" class="btn btn--primary btn--tiny" data-action="rename-session" data-session-id="${session.id}">重命名</button>
              <button type="button" class="btn btn--primary btn--tiny" data-action="delete-session" data-session-id="${session.id}">删除</button>
            </div>
          </div>
        `
          )
          .join("")
      : `<div class="chat-session-empty">暂无会话，点击「+ 新对话」开始</div>`;

    els.sessionList.querySelectorAll(".chat-session-item__main").forEach((button) => {
      button.addEventListener("click", () => selectSession(button.dataset.sessionId));
    });

    els.sessionList.querySelectorAll("[data-action='rename-session']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        const title = prompt("会话名称", "");
        if (title === null) return;
        await window.modelManager.renameChatSession({ sessionId: button.dataset.sessionId, title });
        await loadSessions();
      });
    });

    els.sessionList.querySelectorAll("[data-action='delete-session']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (!confirm("确定删除该会话？")) return;
        await window.modelManager.deleteChatSession(button.dataset.sessionId);
        if (activeSessionId === button.dataset.sessionId) {
          activeSessionId = null;
        }
        await loadSessions();
      });
    });

    if (!activeSessionId && sessions[0]) {
      await selectSession(sessions[0].id);
    } else if (!sessions.length) {
      await createSession();
    }
  }

  async function createSession() {
    if (!activeModel) {
      return;
    }

    const defaultPrompt = prompts[0];
    const session = await window.modelManager.createChatSession({
      modelId: activeModel.id,
      systemPrompt: defaultPrompt?.system || activeModel.ollama?.system || "",
      title: "新对话",
    });
    activeSessionId = session.id;
    await loadSessions();
    await renderSessionMessages();
  }

  async function selectSession(sessionId) {
    activeSessionId = sessionId;
    await loadSessions();
    await renderSessionMessages();
  }

  async function renderSessionMessages() {
    if (!activeSessionId) {
      return;
    }

    const session = await window.modelManager.getChatSession(activeSessionId);
    els.messages.innerHTML = "";

    if (session.systemPrompt) {
      appendMessage("system", `系统提示：${session.systemPrompt}`, { tokens: null });
    }

    for (const message of session.messages) {
      appendMessage(message.role, message.content, { tokens: message.tokens, editable: message.role === "user" });
    }

    updateTokenStats(session);
    stickToBottom = true;
    scrollToBottom(true);
  }

  function appendMessage(role, content, options = {}) {
    const wrapper = document.createElement("article");
    wrapper.className = `chat-message chat-message--${role}`;
    if (options.streaming) {
      wrapper.classList.add("is-streaming");
    }

    const body = document.createElement("div");
    body.className = "chat-message__body";
    body.innerHTML =
      role === "assistant" || role === "system"
        ? window.ChatMarkdown.renderMarkdown(content)
        : escapeText(content);

    const meta = document.createElement("div");
    meta.className = "chat-message__meta";
    if (options.tokens?.totalTokens) {
      meta.textContent = `Token: ${options.tokens.totalTokens}`;
    }
    if (options.editable) {
      meta.innerHTML += `<button type="button" class="btn btn--primary btn--tiny" data-action="edit-user">编辑</button>`;
    }

    wrapper.appendChild(body);
    wrapper.appendChild(meta);
    els.messages.appendChild(wrapper);
    return wrapper;
  }

  function updateTokenStats(session) {
    const lastAssistant = [...session.messages].reverse().find((item) => item.role === "assistant");
    if (lastAssistant?.tokens?.totalTokens) {
      els.tokenStats.textContent = `Token: prompt ${lastAssistant.tokens.promptTokens} · completion ${lastAssistant.tokens.completionTokens} · total ${lastAssistant.tokens.totalTokens}`;
    } else {
      els.tokenStats.textContent = "";
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!activeSessionId || isGenerating) {
      return;
    }

    const message = els.input.value.trim();
    if (!message) {
      return;
    }

    const editing = els.input.dataset.editing === "1";
    els.input.value = "";
    els.input.dataset.editing = "0";
    setGenerating(true);

    appendMessage("user", message);
    const streaming = appendMessage("assistant", "", { streaming: true });

    try {
      const result = await window.modelManager.sendChatMessage({
        sessionId: activeSessionId,
        message,
        editLastUser: editing,
      });
      streaming.querySelector(".chat-message__body").innerHTML = window.ChatMarkdown.renderMarkdown(result.reply);
      streaming.classList.remove("is-streaming");
      if (result.tokens?.totalTokens) {
        streaming.querySelector(".chat-message__meta").textContent = `Token: ${result.tokens.totalTokens}`;
        els.tokenStats.textContent = `Token: prompt ${result.tokens.promptTokens} · completion ${result.tokens.completionTokens} · total ${result.tokens.totalTokens}`;
      }
      await loadSessions();
    } catch (error) {
      streaming.querySelector(".chat-message__body").textContent = `⚠ ${error.message}`;
      streaming.classList.remove("is-streaming");
    } finally {
      setGenerating(false);
      scrollToBottom();
    }
  }

  async function handleStop() {
    if (!activeSessionId) {
      return;
    }
    await window.modelManager.stopChat(activeSessionId);
    setGenerating(false);
  }

  async function handleRegenerate() {
    if (!activeSessionId || isGenerating) {
      return;
    }
    setGenerating(true);
    const streaming = appendMessage("assistant", "", { streaming: true });
    try {
      const result = await window.modelManager.sendChatMessage({
        sessionId: activeSessionId,
        regenerate: true,
      });
      streaming.remove();
      await renderSessionMessages();
      els.tokenStats.textContent = `Token: total ${result.tokens?.totalTokens || 0}`;
    } catch (error) {
      streaming.querySelector(".chat-message__body").textContent = `⚠ ${error.message}`;
    } finally {
      setGenerating(false);
    }
  }

  async function handlePromptChange() {
    if (!activeSessionId) {
      return;
    }
    const prompt = prompts.find((item) => item.id === els.promptSelect.value);
    if (!prompt) {
      return;
    }
    await window.modelManager.setSessionPrompt(activeSessionId, prompt.system);
    await renderSessionMessages();
  }

  function handleMessageActions(event) {
    const copyBtn = event.target.closest(".copy-code-btn");
    if (copyBtn) {
      navigator.clipboard.writeText(decodeURIComponent(copyBtn.dataset.copy || ""));
      copyBtn.textContent = "已复制";
      setTimeout(() => {
        copyBtn.textContent = "复制";
      }, 1200);
      return;
    }

    const editBtn = event.target.closest("[data-action='edit-user']");
    if (editBtn) {
      const messageEl = editBtn.closest(".chat-message");
      const text = messageEl?.querySelector(".chat-message__body")?.textContent || "";
      els.input.value = text;
      els.input.dataset.editing = "1";
      els.input.focus();
    }
  }

  function renderPromptOptions() {
    els.promptSelect.innerHTML = prompts
      .map((item) => `<option value="${item.id}">${item.name}${item.favorite ? " ★" : ""}</option>`)
      .join("");
  }

  async function handleExport() {
    if (!activeSessionId) {
      window.AppCore?.setStatus?.("请先选择或创建一个会话");
      return;
    }
    try {
      const result = await window.modelManager.exportChatSession(activeSessionId);
      if (result.saved) {
        window.AppCore?.setStatus?.(`已导出：${result.path}`);
      }
    } catch (error) {
      window.AppCore?.setStatus?.(`导出失败：${error.message}`);
    }
  }

  function setGenerating(value) {
    isGenerating = value;
    els.stopBtn.disabled = !value;
    els.regenerateBtn.disabled = value;
    els.input.disabled = value;
    els.form.querySelector("button[type='submit']").disabled = value;
  }

  function scrollToBottom(force = false) {
    if (!force && !stickToBottom) {
      return;
    }
    requestAnimationFrame(() => {
      els.messages.scrollTop = els.messages.scrollHeight;
    });
  }

  function escapeText(text) {
    return window.ChatMarkdown.escapeHtml(text).replace(/\n/g, "<br>");
  }

  return { init, open, showPicker, renderReadyModels, onChatPageEnter, enterWithModel };
})();

window.ChatUI = ChatUI;

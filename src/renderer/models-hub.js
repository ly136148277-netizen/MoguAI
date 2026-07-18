/** 模型页：本地 / 联网双入口 + 联网表单 */
const ModelsHub = (() => {
  const PRESETS = {
    deepseek: {
      baseUrl: "https://api.deepseek.com/v1",
      models: ["deepseek-chat", "deepseek-reasoner"],
    },
    openai: {
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4o-mini", "gpt-4o"],
    },
    qwen: {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      models: ["qwen-plus", "qwen-turbo"],
    },
    moonshot: {
      baseUrl: "https://api.moonshot.cn/v1",
      models: ["moonshot-v1-8k"],
    },
    custom: {
      baseUrl: "",
      models: [],
    },
  };

  const els = {};
  let mode = "gate"; // gate | local | online

  function init() {
    els.gate = document.getElementById("models-gate");
    els.local = document.getElementById("models-local");
    els.online = document.getElementById("models-online");
    els.backGate = document.getElementById("models-back-gate-btn");
    els.syncBtn = document.getElementById("sync-btn");
    els.gotoLocal = document.getElementById("models-goto-local-btn");
    els.gotoOnline = document.getElementById("models-goto-online-btn");
    els.preset = document.getElementById("online-api-preset");
    els.modelSelect = document.getElementById("online-model-select");
    els.modelCustomWrap = document.getElementById("online-model-custom-wrap");
    els.modelCustom = document.getElementById("online-model-custom");
    els.apiKey = document.getElementById("online-api-key");
    els.apiBase = document.getElementById("online-api-base");
    els.testBtn = document.getElementById("online-test-btn");
    els.applyBtn = document.getElementById("online-apply-btn");
    els.status = document.getElementById("online-status");

    els.gotoLocal?.addEventListener("click", () => showLocal());
    els.gotoOnline?.addEventListener("click", () => showOnline());
    els.backGate?.addEventListener("click", () => showGate());
    els.preset?.addEventListener("change", onPresetChange);
    els.modelSelect?.addEventListener("change", syncCustomModelVisibility);
    els.testBtn?.addEventListener("click", () => runOnline(true));
    els.applyBtn?.addEventListener("click", () => runOnline(false));
  }

  function onEnter(options = {}) {
    const want = options.modelsMode || sessionStorage.getItem("modelsMode") || "gate";
    if (want === "local") {
      sessionStorage.setItem("modelsMode", "local");
      showLocal();
    } else if (want === "online") {
      sessionStorage.setItem("modelsMode", "online");
      showOnline();
    } else {
      showGate();
    }
  }

  function showGate() {
    mode = "gate";
    sessionStorage.setItem("modelsMode", "gate");
    els.gate?.classList.remove("hidden");
    els.local?.classList.add("hidden");
    els.online?.classList.add("hidden");
    els.backGate?.classList.add("hidden");
    els.syncBtn?.classList.add("hidden");
  }

  function showLocal(opts = {}) {
    mode = "local";
    sessionStorage.setItem("modelsMode", "local");
    els.gate?.classList.add("hidden");
    els.local?.classList.remove("hidden");
    els.online?.classList.add("hidden");
    els.backGate?.classList.remove("hidden");
    els.syncBtn?.classList.remove("hidden");
    if (!opts.skipLoad) {
      window.AppCore?.loadModels?.();
    }
  }

  async function showOnline() {
    mode = "online";
    sessionStorage.setItem("modelsMode", "online");
    els.gate?.classList.add("hidden");
    els.local?.classList.add("hidden");
    els.online?.classList.remove("hidden");
    els.backGate?.classList.remove("hidden");
    els.syncBtn?.classList.add("hidden");
    await loadFormFromSettings();
  }

  async function loadFormFromSettings() {
    try {
      const settings = await window.modelManager.getSettings();
      if (els.preset) els.preset.value = settings.agentApiPreset || "deepseek";
      onPresetChange({ keepModel: true });
      const model = settings.agentApiModel || "";
      if (model && els.modelSelect) {
        const exists = [...els.modelSelect.options].some((o) => o.value === model);
        if (exists) {
          els.modelSelect.value = model;
        } else {
          els.modelSelect.value = "__custom__";
          if (els.modelCustom) els.modelCustom.value = model;
        }
      }
      syncCustomModelVisibility();
      if (els.apiKey) {
        els.apiKey.value = "";
        if (settings.secureStorageAvailable === false) {
          els.apiKey.placeholder = "安全存储不可用，无法保存密钥";
          els.apiKey.disabled = true;
        } else {
          els.apiKey.disabled = false;
          els.apiKey.placeholder = settings.agentApiKeyConfigured
            ? "已配置（留空则保持不变）"
            : "API Key";
        }
      }
      if (els.apiBase) els.apiBase.value = settings.agentApiBaseUrl || els.apiBase.value;
    } catch {
      onPresetChange();
    }
  }

  function onPresetChange(options = {}) {
    const key = els.preset?.value || "deepseek";
    const preset = PRESETS[key] || PRESETS.custom;
    if (els.apiBase && (key !== "custom" || !els.apiBase.value)) {
      els.apiBase.value = preset.baseUrl;
    } else if (els.apiBase && key !== "custom") {
      els.apiBase.value = preset.baseUrl;
    }

    if (els.modelSelect && !options.keepModel) {
      const models = preset.models.length ? preset.models : ["custom-model"];
      els.modelSelect.innerHTML =
        models.map((m) => `<option value="${m}">${m}</option>`).join("") +
        `<option value="__custom__">自定义输入…</option>`;
      els.modelSelect.value = models[0] || "__custom__";
    } else if (els.modelSelect && options.keepModel) {
      const current = els.modelSelect.value;
      const models = preset.models.length ? preset.models : [];
      const opts = new Set([...models, current === "__custom__" ? null : current].filter(Boolean));
      els.modelSelect.innerHTML =
        [...opts].map((m) => `<option value="${m}">${m}</option>`).join("") +
        `<option value="__custom__">自定义输入…</option>`;
      if (current) els.modelSelect.value = current;
    }
    syncCustomModelVisibility();
  }

  function syncCustomModelVisibility() {
    const custom = els.modelSelect?.value === "__custom__";
    els.modelCustomWrap?.classList.toggle("hidden", !custom);
  }

  async function collectForm() {
    const preset = els.preset?.value || "custom";
    let model = els.modelSelect?.value || "";
    if (model === "__custom__") {
      model = els.modelCustom?.value?.trim() || "";
    }
    const payload = {
      agentBrainChannel: "api",
      agentApiPreset: preset,
      agentApiBaseUrl: els.apiBase?.value?.trim() || "",
      agentApiModel: model,
    };
    const key = els.apiKey?.value?.trim() || "";
    if (key) payload.agentApiKey = key;
    return payload;
  }

  async function runOnline(testOnly) {
    const payload = await collectForm();
    if (!payload.agentApiModel) {
      setStatus("请选择或填写模型名称");
      return;
    }
    const settings = await window.modelManager.getSettings();
    if (settings.secureStorageAvailable === false && payload.agentApiKey) {
      setStatus("安全存储不可用，无法保存密钥（不会以明文写入）");
      return;
    }
    if (!payload.agentApiKey && !settings.agentApiKeyConfigured) {
      setStatus("请填写 API 密钥");
      return;
    }
    if (!payload.agentApiBaseUrl) {
      setStatus("请填写 API Base URL（可在高级里改）");
      return;
    }

    els.applyBtn && (els.applyBtn.disabled = true);
    els.testBtn && (els.testBtn.disabled = true);
    setStatus(testOnly ? "测试中…" : "保存并生效中…");

    try {
      await window.modelManager.updateSettings(payload);
      const result = await window.modelManager.testAgentBrain();
      if (testOnly) {
        setStatus(result.message + (result.sample ? ` · ${result.sample}` : ""));
        window.AppCore?.setStatus?.(result.message || "测试完成");
        return;
      }
      setStatus(`已生效：Agent 将用 ${payload.agentApiModel} 引导。可去 Agent 页试用。`);
      window.AppCore?.setStatus?.("联网模型已用于 Agent");
      window.AppCore?.loadSettingsForm?.();
    } catch (error) {
      setStatus(`失败：${error.message}`);
      window.AppCore?.setStatus?.(`联网模型失败：${error.message}`);
    } finally {
      els.applyBtn && (els.applyBtn.disabled = false);
      els.testBtn && (els.testBtn.disabled = false);
    }
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text || "";
  }

  function getMode() {
    return mode;
  }

  return { init, onEnter, showGate, showLocal, showOnline, getMode };
})();

window.ModelsHub = ModelsHub;

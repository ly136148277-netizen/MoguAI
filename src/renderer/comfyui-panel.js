const ComfyUiPanel = (() => {
  let presets = [];
  let progressUnsubscribe = null;
  let activeRunId = null;

  const els = {};

  function init() {
    els.statusDot = document.getElementById("comfyui-status-dot");
    els.statusText = document.getElementById("comfyui-status-text");
    els.presets = document.getElementById("comfyui-presets");
    els.catalogMeta = document.getElementById("comfyui-catalog-meta");
    els.catalogList = document.getElementById("comfyui-catalog-list");
    els.refreshBtn = document.getElementById("comfyui-refresh-btn");
    els.openBtn = document.getElementById("comfyui-open-btn");
    els.runLog = document.getElementById("comfyui-run-log");
    els.runStatus = document.getElementById("comfyui-run-status");
    els.runOutput = document.getElementById("comfyui-run-output");
    els.progressWrap = document.getElementById("comfyui-progress-wrap");
    els.progressFill = document.getElementById("comfyui-progress-fill");
    els.progressText = document.getElementById("comfyui-progress-text");

    presets = window.PaiCatalog?.FALLBACK_PRESETS || [];

    els.refreshBtn?.addEventListener("click", () => loadPanel(true));
    els.openBtn?.addEventListener("click", () => runButlerCommand("打开 ComfyUI", 1));
    window.AppRouter.onPage("comfyui", onPageEnter);

    if (window.modelManager?.onPaiRunProgress) {
      progressUnsubscribe = window.modelManager.onPaiRunProgress(handleProgressEvent);
    }
  }

  function handleProgressEvent(payload) {
    if (!payload || (activeRunId && payload.runId !== activeRunId)) {
      return;
    }
    updateProgressUi(payload);
  }

  function updateProgressUi(progress) {
    if (!els.progressText) {
      return;
    }
    els.progressWrap?.classList.remove("hidden");
    els.progressText.textContent = progress.message || "处理中…";

    const phase = progress.phase || "running";
    els.runStatus.textContent =
      phase === "completed" ? "完成" : phase === "failed" ? "失败" : phase === "queued" ? "排队中" : "执行中";
    els.runStatus.classList.toggle("badge--danger", phase === "failed");

    if (els.progressFill) {
      els.progressFill.classList.toggle("is-indeterminate", phase === "running" || phase === "submitting");
      els.progressFill.classList.toggle("is-complete", phase === "completed");
      els.progressFill.classList.toggle("is-failed", phase === "failed");
    }
  }

  function renderPresets() {
    if (!els.presets) {
      return;
    }
    els.presets.innerHTML = presets
      .map(
        (preset) => `
        <article class="comfyui-preset-card">
          <h4>${escapeHtml(preset.label)}</h4>
          <p>${escapeHtml(preset.note || preset.workflow || "")}</p>
          <button type="button" class="btn btn--primary btn--tiny" data-preset-cmd="${escapeHtml(preset.command)}">出片</button>
        </article>
      `
      )
      .join("");

    els.presets.querySelectorAll("[data-preset-cmd]").forEach((button) => {
      button.addEventListener("click", () => {
        runWorkflow(button.dataset.presetCmd, button.closest(".comfyui-preset-card")?.querySelector("h4")?.textContent);
      });
    });
  }

  async function onPageEnter() {
    await loadPanel(false);
  }

  async function loadPanel(force) {
    setBusy(true);
    try {
      await refreshComfyUiStatus();
      await loadPresetsFromPai();
      await loadWorkflowCatalog(force);
    } finally {
      setBusy(false);
    }
  }

  async function loadPresetsFromPai() {
    try {
      await window.modelManager.ensurePai();
      const data = await window.modelManager.fetchPaiPresets();
      if (data?.ok && Array.isArray(data.presets)) {
        presets = window.PaiCatalog?.mergePresets(data.presets) || data.presets;
      }
    } catch {
      presets = window.PaiCatalog?.FALLBACK_PRESETS || presets;
    }
    renderPresets();
  }

  async function refreshComfyUiStatus() {
    try {
      const status = await window.modelManager.getComfyUiStatus();
      if (!status.path && !status.api) {
        setStatusUi("offline", "未配置 ComfyUI — 可在管家页「一键识别本机」写入 PAI");
        return;
      }
      if (status.running) {
        const queue =
          status.queueRunning || status.queuePending
            ? ` · 队列 ${status.queueRunning}/${status.queuePending}`
            : "";
        setStatusUi("online", `ComfyUI 已连接 ${status.api}${queue}`);
        return;
      }
      setStatusUi("stopped", `ComfyUI 未运行 · ${status.path || status.api}`);
    } catch (error) {
      setStatusUi("offline", `状态检测失败：${error.message}`);
    }
  }

  function setStatusUi(state, text) {
    if (!els.statusText || !els.statusDot) {
      return;
    }
    els.statusText.textContent = text;
    els.statusDot.classList.remove(
      "comfyui-status__dot--online",
      "comfyui-status__dot--stopped",
      "comfyui-status__dot--offline"
    );
    if (state === "online") {
      els.statusDot.classList.add("comfyui-status__dot--online");
    } else if (state === "stopped") {
      els.statusDot.classList.add("comfyui-status__dot--stopped");
    } else {
      els.statusDot.classList.add("comfyui-status__dot--offline");
    }
  }

  async function loadWorkflowCatalog(force) {
    if (!els.catalogList) {
      return;
    }

    els.catalogMeta.textContent = force ? "刷新中…" : "加载中…";
    els.catalogList.innerHTML = `<p class="comfyui-catalog__empty">正在从 PAI 拉取工作流列表…</p>`;

    try {
      await window.modelManager.ensurePai();
      let workflows = [];
      let updatedAt = "";

      try {
        const catalog = await window.modelManager.fetchPaiCatalog();
        if (catalog?.ok) {
          workflows = catalog.workflows || [];
          updatedAt = catalog.catalog_updated_at || "";
        }
      } catch {
        const result = await window.modelManager.runPaiCommand({ command: "列出工作流", level: 1 });
        if (!result.ok) {
          throw new Error(result.error || "列出工作流失败");
        }
        workflows = result.workflows || [];
        updatedAt = result.catalog_updated_at || "";
      }

      const meta = updatedAt ? `${workflows.length} 个工作流 · 同步 ${updatedAt.slice(0, 19)}` : `${workflows.length} 个工作流`;
      els.catalogMeta.textContent = meta;

      if (!workflows.length) {
        els.catalogList.innerHTML = `<p class="comfyui-catalog__empty">暂无工作流，请检查 PAI / ComfyUI 配置。</p>`;
        return;
      }

      els.catalogList.innerHTML = workflows
        .map((item) => {
          const name = item.name || item.catalog_id || "未命名";
          const runnable = item.runnable_by_pai !== false && !/upscale|放大/i.test(name);
          const valid = item.validation_ok !== false;
          const badge = !runnable ? "manual" : valid ? "ok" : "warn";
          const badgeText = !runnable ? "仅手动" : valid ? "可 API" : "待校验";
          const kind = item.kind || item.summary || "";
          return `
            <article class="comfyui-workflow-row">
              <div class="comfyui-workflow-row__main">
                <strong>${escapeHtml(name)}</strong>
                <span class="comfyui-workflow-row__kind">${escapeHtml(kind)}</span>
              </div>
              <div class="comfyui-workflow-row__actions">
                <span class="comfyui-workflow-row__badge comfyui-workflow-row__badge--${badge}">${badgeText}</span>
                ${
                  runnable
                    ? `<button type="button" class="btn btn--primary btn--tiny" data-run-workflow="${escapeHtml(name)}">出片</button>`
                    : `<span class="comfyui-workflow-row__hint">请在 ComfyUI 手动运行</span>`
                }
              </div>
            </article>
          `;
        })
        .join("");

      els.catalogList.querySelectorAll("[data-run-workflow]").forEach((button) => {
        button.addEventListener("click", () => {
          const workflow = button.dataset.runWorkflow;
          runWorkflow(`确认出片 ${workflow}`, workflow);
        });
      });
    } catch (error) {
      els.catalogMeta.textContent = "加载失败";
      els.catalogList.innerHTML = `<p class="comfyui-catalog__empty">❌ ${escapeHtml(error.message)}</p>`;
    }
  }

  async function runWorkflow(command, label) {
    if (window.ButlerRisk && window.ButlerUI?.showConfirmModal) {
      const assessment = window.ButlerRisk.assess(command, 2);
      if (assessment.needsConfirm) {
        const approved = await window.ButlerUI.showConfirmModal(assessment);
        if (!approved) {
          return;
        }
        command = assessment.confirmedCommand || command;
      }
    }

    showRunLog(`正在提交：${label || command}`);
    setBusy(true);
    activeRunId = `comfy-${Date.now()}`;

    try {
      await window.modelManager.ensurePai();
      const tracked = await window.modelManager.runPaiCommandTracked({
        command,
        level: 2,
        runId: activeRunId,
      });
      const result = tracked?.result || tracked;

      if (result?.needs_confirm && window.ButlerUI?.showConfirmModal && window.ButlerRisk) {
        const paiAssessment = window.ButlerRisk.assessPaiResponse(command, result);
        if (paiAssessment) {
          const approved = await window.ButlerUI.showConfirmModal(paiAssessment);
          if (!approved) {
            hideRunLog();
            return;
          }
          command = paiAssessment.confirmedCommand || command;
          showRunLog(`已确认，正在出片：${label || command}`);
          activeRunId = `comfy-retry-${Date.now()}`;
          const retry = await window.modelManager.runPaiCommandTracked({
            command,
            level: 2,
            runId: activeRunId,
          });
          renderRunResult(retry?.result || retry, label);
          return;
        }
      }
      renderRunResult(result, label);
    } catch (error) {
      renderRunResult({ ok: false, error: error.message }, label);
    } finally {
      activeRunId = null;
      setBusy(false);
      await refreshComfyUiStatus();
    }
  }

  async function runButlerCommand(command, level) {
    if (window.ButlerUI?.runCommand) {
      window.AppRouter.navigate("butler");
      await window.ButlerUI.runCommand(command, { level, skipRiskCheck: command === "打开 ComfyUI" });
      return;
    }
    await window.modelManager.runPaiCommand({ command, level });
  }

  function showRunLog(message) {
    if (!els.runLog) {
      return;
    }
    els.runLog.classList.remove("hidden");
    els.runStatus.textContent = "执行中…";
    els.runOutput.textContent = message;
    updateProgressUi({ phase: "submitting", message: "正在提交 PAI…" });
  }

  function hideRunLog() {
    els.runLog?.classList.add("hidden");
  }

  function renderRunResult(result, label) {
    if (!els.runLog) {
      return;
    }
    els.runLog.classList.remove("hidden");
    els.runStatus.textContent = result.ok ? "完成" : "失败";
    els.runStatus.classList.toggle("badge--danger", !result.ok);
    updateProgressUi({
      phase: result.ok ? "completed" : "failed",
      message: result.message || result.error || (result.ok ? "完成" : "失败"),
    });

    const lines = [];
    if (label) {
      lines.push(`任务：${label}`);
    }
    if (result.capability) {
      lines.push(`Capability：${result.capability}`);
    }
    if (result.prompt_id) {
      lines.push(`Prompt ID：${result.prompt_id}`);
    }
    if (result.message) {
      lines.push(result.message);
    }
    if (result.path) {
      lines.push(`输出：${result.path}`);
    }
    if (result.error) {
      lines.push(`错误：${result.error}`);
    }
    if (result.hint) {
      lines.push(`提示：${result.hint}`);
    }
    els.runOutput.textContent = lines.join("\n") || (result.ok ? "完成" : "失败");
  }

  function setBusy(busy) {
    if (els.refreshBtn) {
      els.refreshBtn.disabled = busy;
    }
    if (els.openBtn) {
      els.openBtn.disabled = busy;
    }
    els.presets?.querySelectorAll("button").forEach((button) => {
      button.disabled = busy;
    });
    els.catalogList?.querySelectorAll("button").forEach((button) => {
      button.disabled = busy;
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { init };
})();

window.ComfyUiPanel = ComfyUiPanel;

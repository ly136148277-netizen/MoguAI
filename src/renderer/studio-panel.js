const StudioPanel = (() => {
  const els = {};
  let pipeline = {};
  let workflows = [];
  let pickSlot = null;
  let progressUnsub = null;
  let activeRunId = null;
  /** @type {Map<string, string>} runId -> promptId from progress events */
  const promptByRunId = new Map();
  let stageMonitorTimer = null;
  let activeMonitorStage = null;
  let cancelRequested = false;
  let runGeneration = 0;

  function init() {
    els.envOllama = document.getElementById("studio-env-ollama");
    els.envPai = document.getElementById("studio-env-pai");
    els.envComfy = document.getElementById("studio-env-comfy");
    els.envFfmpeg = document.getElementById("studio-env-ffmpeg");
    els.envAll = document.getElementById("studio-env-all");
    els.character = document.getElementById("studio-character");
    els.action = document.getElementById("studio-action");
    els.size = document.getElementById("studio-size");
    els.clarity = document.getElementById("studio-clarity");
    els.duration = document.getElementById("studio-duration");
    els.photoLabel = document.getElementById("studio-photo-label");
    els.addPhoto = document.getElementById("studio-add-photo-btn");
    els.addT2i = document.getElementById("studio-add-t2i-btn");
    els.addI2v = document.getElementById("studio-add-i2v-btn");
    els.t2iName = document.getElementById("studio-t2i-name");
    els.i2vName = document.getElementById("studio-i2v-name");
    els.t2iProgress = document.getElementById("studio-t2i-progress");
    els.t2iProgressFill = document.getElementById("studio-t2i-progress-fill");
    els.t2iProgressText = document.getElementById("studio-t2i-progress-text");
    els.t2iPreview = document.getElementById("studio-t2i-preview");
    els.t2iPreviewImg = document.getElementById("studio-t2i-preview-img");
    els.t2iPreviewPath = document.getElementById("studio-t2i-preview-path");
    els.i2vProgress = document.getElementById("studio-i2v-progress");
    els.i2vProgressFill = document.getElementById("studio-i2v-progress-fill");
    els.i2vProgressText = document.getElementById("studio-i2v-progress-text");
    els.i2vPreview = document.getElementById("studio-i2v-preview");
    els.i2vPreviewVideo = document.getElementById("studio-i2v-preview-video");
    els.i2vPreviewPath = document.getElementById("studio-i2v-preview-path");
    els.runBtn = document.getElementById("studio-run-btn");
    els.cancelBtn = document.getElementById("studio-cancel-btn");
    els.log = document.getElementById("studio-log");
    els.progressWrap = document.getElementById("studio-progress-wrap");
    els.progressFill = document.getElementById("studio-progress-fill");
    els.progressText = document.getElementById("studio-progress-text");
    els.guide = document.getElementById("studio-guide");
    els.guideMeta = document.getElementById("studio-guide-meta");
    els.tip = document.getElementById("studio-tip");
    els.tipDismiss = document.getElementById("studio-tip-dismiss");
    els.runPanel = document.getElementById("studio-run-panel");
    els.clearLogBtn = document.getElementById("studio-clear-log-btn");
    els.modal = document.getElementById("studio-workflow-modal");
    els.modalTitle = document.getElementById("studio-workflow-modal-title");
    els.modalList = document.getElementById("studio-workflow-modal-list");
    els.modalCancel = document.getElementById("studio-workflow-modal-cancel");
    els.importBtn = document.getElementById("studio-workflow-import-btn");
    els.refreshWorkflowsBtn = document.getElementById("studio-workflow-refresh-btn");

    els.tipDismiss?.addEventListener("click", dismissTip);
    els.addPhoto?.addEventListener("click", pickPhoto);
    els.addT2i?.addEventListener("click", () => openWorkflowPicker("t2i"));
    els.addI2v?.addEventListener("click", () => openWorkflowPicker("i2v"));
    els.runBtn?.addEventListener("click", runStudio);
    els.cancelBtn?.addEventListener("click", cancelStudio);
    els.modalCancel?.addEventListener("click", closeModal);
    els.importBtn?.addEventListener("click", importWorkflow);
    els.clearLogBtn?.addEventListener("click", clearRunPanel);
    els.refreshWorkflowsBtn?.addEventListener("click", async () => {
      if (!pickSlot) return;
      await openWorkflowPicker(pickSlot);
    });
    els.modal?.querySelector("[data-studio-close]")?.addEventListener("click", closeModal);

    ["change", "blur"].forEach((evt) => {
      els.character?.addEventListener(evt, persistFields);
      els.action?.addEventListener(evt, persistFields);
    });
    els.size?.addEventListener("change", () => {
      pipeline.size = els.size?.value || "";
      persistFields();
    });
    els.clarity?.addEventListener("change", () => {
      pipeline.clarity = els.clarity?.value || "";
      persistFields();
    });
    els.duration?.addEventListener("change", () => {
      pipeline.duration = els.duration?.value || "";
      persistFields();
    });

    if (window.modelManager?.onPaiRunProgress) {
      progressUnsub = window.modelManager.onPaiRunProgress((payload) => {
        if (!payload?.runId) return;
        if (payload.promptId) {
          promptByRunId.set(payload.runId, String(payload.promptId));
        }
        if (activeRunId && payload.runId !== activeRunId) return;
        showProgress(payload);
      });
    }

    window.AppRouter.onPage("studio", onEnter);
  }

  async function onEnter() {
    await refreshEnv();
    pipeline = (await window.modelManager.getStudioPipeline()) || {};
    applyPipelineToForm();
    await loadWorkflows({ sync: true });
    updateGuideMeta();
    // 未执行时只显示一行 tip，不露大块空白日志框
    if (!els.log?.textContent?.trim()) {
      showTip(true);
      showGuide(false);
      showRunPanel(false);
    } else {
      showTip(false);
    }
  }

  function dismissTip() {
    try {
      localStorage.setItem("studioTipDismissed", "1");
    } catch {
      /* ignore */
    }
    showTip(false);
  }

  function showTip(visible) {
    if (!els.tip) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("studioTipDismissed") === "1";
    } catch {
      dismissed = false;
    }
    if (dismissed || !visible) {
      els.tip.classList.add("hidden");
      return;
    }
    els.tip.classList.remove("hidden");
  }

  function updateGuideMeta() {
    if (!els.guideMeta) return;
    const n = workflows.length;
    const images = workflows.filter((w) => (w.kind || "").toLowerCase() === "image").length;
    const videos = workflows.filter((w) => (w.kind || "").toLowerCase() === "video").length;
    els.guideMeta.textContent =
      n > 0
        ? `已识别 ${n} 个工作流（图 ${images} · 视频 ${videos}）。点「+」直接选，无需打开文件夹。`
        : "尚未识别到工作流。请把 .json 放进 PAI/workflows 或 ComfyUI 的 user/default/workflows，再点「+」刷新。";
  }

  function showGuide(visible) {
    els.guide?.classList.toggle("hidden", !visible);
  }

  function showRunPanel(visible) {
    els.runPanel?.classList.toggle("hidden", !visible);
  }

  function clearRunPanel() {
    if (els.log) els.log.textContent = "";
    els.progressWrap?.classList.add("hidden");
    showRunPanel(false);
    showGuide(false);
    showTip(true);
  }

  function applySelectValue(selectEl, savedValue) {
    if (!selectEl) return "";
    const allowed = new Set([...selectEl.options].map((opt) => opt.value));
    const saved = String(savedValue || "");
    selectEl.value = allowed.has(saved) ? saved : "";
    return selectEl.value;
  }

  function parseSize(size) {
    const raw = String(size || "").trim().toLowerCase().replace("×", "x");
    if (!raw.includes("x")) return { width: "", height: "" };
    const [width, height] = raw.split("x").map((part) => part.trim());
    return {
      width: /^\d+$/.test(width) ? width : "",
      height: /^\d+$/.test(height) ? height : "",
    };
  }

  function applyPipelineToForm() {
    if (els.character) els.character.value = pipeline.character || "";
    if (els.action) els.action.value = pipeline.action || "";
    pipeline.size = applySelectValue(els.size, pipeline.size);
    pipeline.clarity = applySelectValue(els.clarity, pipeline.clarity);
    pipeline.duration = applySelectValue(els.duration, pipeline.duration);
    if (els.t2iName) els.t2iName.textContent = pipeline.t2iWorkflow || "未选择";
    if (els.i2vName) els.i2vName.textContent = pipeline.i2vWorkflow || "未选择";
    if (els.photoLabel) {
      els.photoLabel.textContent = pipeline.imagePath ? `照片：${pipeline.imagePath}` : "未添加参考照片";
    }
  }

  function studioOverrideFields() {
    const size = pipeline.size || "";
    const { width, height } = parseSize(size);
    return {
      size,
      width,
      height,
      clarity: pipeline.clarity || "",
      duration: pipeline.duration || "",
    };
  }

  async function persistFields() {
    pipeline = {
      ...pipeline,
      character: els.character?.value || "",
      action: els.action?.value || "",
      size: pipeline.size || "",
      clarity: pipeline.clarity || "",
      duration: els.duration?.value || pipeline.duration || "",
    };
    await window.modelManager.saveStudioPipeline(pipeline);
  }

  async function refreshEnv() {
    try {
      const status = await window.modelManager.getSetupStatus();
      const ollamaOk = Boolean(status.ready?.ollama);
      const paiOk = Boolean(status.ready?.pai);
      const comfyOk = Boolean(status.ready?.comfyui);
      const ffmpegOk = Boolean(status.ready?.ffmpeg);
      const allOk = Boolean(status.allReady) || (ollamaOk && paiOk && comfyOk);
      setChip(els.envOllama, "Ollama", ollamaOk);
      setChip(els.envPai, "PAI", paiOk);
      setChip(els.envComfy, "ComfyUI", comfyOk);
      setChip(els.envFfmpeg, "FFmpeg", ffmpegOk);
      setChip(els.envAll, "环境", allOk);
    } catch {
      setChip(els.envOllama, "Ollama", false);
      setChip(els.envPai, "PAI", false);
      setChip(els.envComfy, "ComfyUI", false);
      setChip(els.envFfmpeg, "FFmpeg", false);
      setChip(els.envAll, "环境", false);
    }
  }

  function setChip(el, label, ok) {
    if (!el) return;
    el.textContent = `${label} ${ok ? "✓" : "✗"}`;
    el.classList.toggle("studio-env-chip--ok", Boolean(ok));
    el.classList.toggle("studio-env-chip--bad", !ok);
  }

  async function loadWorkflows({ sync = false } = {}) {
    try {
      await window.modelManager.ensurePai();
      if (sync) {
        try {
          await window.modelManager.runPaiCommand({ command: "同步工作流", level: 1 });
        } catch {
          // best-effort; still try catalog fetch
        }
      }
      const catalog = await window.modelManager.fetchPaiCatalog();
      workflows = catalog?.workflows || [];
    } catch {
      workflows = [];
    }
    return workflows;
  }

  async function pickPhoto() {
    const result = await window.modelManager.pickStudioImage();
    if (result?.ok) {
      pipeline.imagePath = result.imagePath;
      applyPipelineToForm();
    }
  }

  async function openWorkflowPicker(slot) {
    pickSlot = slot;
    if (els.modalTitle) {
      els.modalTitle.textContent = slot === "t2i" ? "选择文生图工作流" : "选择图生视频工作流";
    }
    els.modal?.classList.remove("hidden");
    if (els.modalList) {
      els.modalList.innerHTML = `<p class="comfyui-catalog__empty">正在识别本机工作流…</p>`;
    }

    // 点 + 时自动同步扫描 PAI/workflows + ComfyUI user/workflows
    await loadWorkflows({ sync: true });

    const wantKind = slot === "t2i" ? "image" : "video";
    const list = workflows.filter((w) => {
      const kind = (w.kind || "").toLowerCase();
      if (slot === "t2i") return !kind || kind === "image" || kind === "unknown";
      return !kind || kind === "video" || kind === "unknown";
    });
    if (els.modalList) {
      if (!list.length) {
        els.modalList.innerHTML = `<p class="comfyui-catalog__empty">暂无工作流。请把 .json 放进 PAI/workflows 或 ComfyUI 的 user/default/workflows，再点下方「刷新列表」；也可「从文件添加」。</p>`;
      } else {
        els.modalList.innerHTML = list
          .map((w) => {
            const name = w.name || w.catalog_id;
            const ok = w.runnable_by_pai !== false && w.validation_ok !== false;
            return `<button type="button" class="studio-workflow-item" data-name="${escapeAttr(name)}">
              <strong>${escapeHtml(name)}</strong>
              <span>${escapeHtml(w.kind || wantKind)} · ${ok ? "可 API" : "待校验"}</span>
            </button>`;
          })
          .join("");
        els.modalList.querySelectorAll("[data-name]").forEach((btn) => {
          btn.addEventListener("click", () => selectWorkflow(btn.dataset.name));
        });
      }
    }
  }

  async function selectWorkflow(name) {
    if (pickSlot === "t2i") pipeline.t2iWorkflow = name;
    if (pickSlot === "i2v") pipeline.i2vWorkflow = name;
    await window.modelManager.saveStudioPipeline(pipeline);
    applyPipelineToForm();
    closeModal();
  }

  async function importWorkflow() {
    const result = await window.modelManager.importStudioWorkflow();
    if (result?.ok) {
      await loadWorkflows();
      await selectWorkflow(result.name);
      appendLog(`已导入工作流：${result.name}`);
    }
  }

  function closeModal() {
    els.modal?.classList.add("hidden");
    pickSlot = null;
  }

  function resetStageUi() {
    stopStageMonitor();
    setStageProgress("t2i", { phase: "idle" });
    setStageProgress("i2v", { phase: "idle" });
    hideStagePreview("t2i");
    hideStagePreview("i2v");
  }

  function formatElapsed(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}分${String(s).padStart(2, "0")}秒` : `${s}秒`;
  }

  function formatDurationLabel(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return String(seconds || "");
    if (n < 60) return `${n}秒`;
    if (n % 60 === 0) return `${n / 60}分钟`;
    return `${Math.floor(n / 60)}分${n % 60}秒`;
  }

  function estimateSeconds(workflowName, fallback) {
    const match = String(workflowName || "").match(/(\d+)\s*秒/);
    if (match) return Math.max(30, Number(match[1]));
    return fallback;
  }

  function estimateI2vSeconds(workflowName, durationSec) {
    const named = estimateSeconds(workflowName, 0);
    const nameClip = Number(String(workflowName || "").match(/(\d+)\s*秒/)?.[1] || 0);
    const baseWall = named || 330;
    const baseClip = nameClip > 0 ? nameClip : 5;
    const secPerClipSec = baseWall / baseClip;
    if (durationSec && Number(durationSec) > 0) {
      return Math.max(90, Math.round(secPerClipSec * Number(durationSec)));
    }
    return Math.max(90, baseWall);
  }

  /** 时间估算读条：到预计时间约 20%，超时后缓慢逼近 95%，避免过早卡在高位。 */
  function estimateProgressPercent(elapsedSec, expectedSec) {
    const expected = Math.max(30, expectedSec);
    const ratio = Math.max(0, elapsedSec) / expected;
    // 100 * r/(r+4) → r=1 时约 20%；超时后渐近上限 100，再封顶 95
    const pct = Math.round((100 * ratio) / (ratio + 4));
    return Math.max(1, Math.min(95, pct));
  }

  function setStageProgress(stage, { phase = "idle", message = "", percent = null } = {}) {
    const wrap = stage === "t2i" ? els.t2iProgress : els.i2vProgress;
    const fill = stage === "t2i" ? els.t2iProgressFill : els.i2vProgressFill;
    const text = stage === "t2i" ? els.t2iProgressText : els.i2vProgressText;
    if (!wrap) return;
    if (phase === "idle") {
      wrap.classList.add("hidden");
      if (fill) fill.style.width = "0%";
      return;
    }
    wrap.classList.remove("hidden");
    let pct = percent;
    if (phase === "completed") pct = 100;
    if (phase === "failed") pct = 100;
    if (pct == null && (phase === "running" || phase === "submitting")) pct = 1;
    if (fill && pct != null) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    fill?.classList.toggle("is-complete", phase === "completed");
    fill?.classList.toggle("is-failed", phase === "failed");
    if (text) {
      const pctLabel = pct != null && phase !== "failed" ? `${Math.round(pct)}%` : "";
      const base =
        message ||
        (phase === "completed" ? "已完成" : phase === "failed" ? "失败" : "处理中…");
      text.textContent = pctLabel && !String(base).includes("%") ? `${pctLabel} · ${base}` : base;
    }
  }

  function stopStageMonitor() {
    if (stageMonitorTimer) {
      clearInterval(stageMonitorTimer);
      stageMonitorTimer = null;
    }
  }

  function markStageCancelled(stage) {
    const target = stage || activeMonitorStage;
    if (!target) return;
    setStageProgress(target, {
      phase: "failed",
      percent: 100,
      message: "已取消",
    });
  }

  function startStageMonitor(stage, expectedSeconds) {
    stopStageMonitor();
    activeMonitorStage = stage;
    const startedAt = Date.now();
    const expected = Math.max(30, Number(expectedSeconds) || 120);
    const isVideo = stage === "i2v";
    const waitHint = isVideo
      ? "视频正在生成中 · 请耐心等待 · 确需停止可点取消 · 可打开 ComfyUI 后台查看"
      : "请耐心等待 · 确需停止可点取消 · 可打开 ComfyUI 后台查看";
    setStageProgress(stage, {
      phase: "running",
      percent: 1,
      message: `已用时 ${formatElapsed(0)} / 约 ${formatElapsed(expected)} · ${waitHint}`,
    });
    stageMonitorTimer = setInterval(async () => {
      if (cancelRequested) {
        stopStageMonitor();
        markStageCancelled(stage);
        return;
      }
      const elapsedSec = (Date.now() - startedAt) / 1000;
      let percent = estimateProgressPercent(elapsedSec, expected);
      let detail = `已用时 ${formatElapsed(elapsedSec)} / 约 ${formatElapsed(expected)}`;
      if (elapsedSec > expected) {
        detail = `已用时 ${formatElapsed(elapsedSec)}（超过预估 ${formatElapsed(expected)}，仍在生成）`;
      }
      detail = `${detail} · ${waitHint}`;
      try {
        const snap = await window.modelManager.getComfyUiProgress?.({});
        if (cancelRequested) {
          stopStageMonitor();
          markStageCancelled(stage);
          return;
        }
        if (snap?.message) {
          detail = `${detail} · ${snap.message}`;
        }
        if (snap?.phase === "queued") {
          percent = Math.min(percent, 8);
        }
        if (snap?.phase === "completed") {
          percent = Math.max(percent, 96);
        }
      } catch {
        // ignore poll errors
      }
      if (cancelRequested) {
        stopStageMonitor();
        markStageCancelled(stage);
        return;
      }
      setStageProgress(stage, { phase: "running", percent, message: detail });
    }, 1000);
  }

  function hideStagePreview(stage) {
    if (stage === "t2i") {
      els.t2iPreview?.classList.add("hidden");
      if (els.t2iPreviewImg) els.t2iPreviewImg.removeAttribute("src");
      if (els.t2iPreviewPath) els.t2iPreviewPath.textContent = "";
      return;
    }
    els.i2vPreview?.classList.add("hidden");
    if (els.i2vPreviewVideo) {
      els.i2vPreviewVideo.pause?.();
      els.i2vPreviewVideo.removeAttribute("src");
      els.i2vPreviewVideo.load?.();
    }
    if (els.i2vPreviewPath) els.i2vPreviewPath.textContent = "";
  }

  async function showStageMedia(stage, filePath) {
    if (!filePath || !window.modelManager.getStudioMediaUrl) return null;
    try {
      const media = await window.modelManager.getStudioMediaUrl(filePath);
      if (!media?.ok) return null;
      if (stage === "t2i") {
        els.t2iPreview?.classList.remove("hidden");
        if (els.t2iPreviewImg) els.t2iPreviewImg.src = media.url;
        if (els.t2iPreviewPath) els.t2iPreviewPath.textContent = media.path;
      } else {
        els.i2vPreview?.classList.remove("hidden");
        if (els.i2vPreviewVideo) {
          els.i2vPreviewVideo.src = media.url;
          els.i2vPreviewVideo.load?.();
        }
        if (els.i2vPreviewPath) els.i2vPreviewPath.textContent = media.path;
      }
      return media;
    } catch (error) {
      appendLog(`预览失败：${error.message}`);
      return null;
    }
  }

  function pickOutputPath(result, prefer = "any") {
    if (!result) return "";
    const candidates = [];
    if (result.image_path) candidates.push(result.image_path);
    if (result.path) candidates.push(result.path);
    for (const step of result.steps || []) {
      if (step.path) candidates.push(step.path);
      for (const out of step.outputs || []) {
        if (out?.path) candidates.push(out.path);
      }
    }
    const images = candidates.filter((p) => /\.(png|jpe?g|webp|bmp)$/i.test(String(p)));
    const videos = candidates.filter((p) => /\.(mp4|webm|mov|mkv|avi|gif)$/i.test(String(p)));
    if (prefer === "image") return images[0] || "";
    if (prefer === "video") return videos[0] || "";
    return videos[0] || images[0] || candidates[0] || "";
  }

  async function invokeStudioStage(payload) {
    const tracked = await window.modelManager.runStudio(payload);
    return tracked?.result || tracked;
  }

  function isCancelledResult(result, error) {
    if (cancelRequested) return true;
    const msg = String(result?.error || error?.message || "");
    return /已取消|中断|interrupt|cancelled|canceled/i.test(msg);
  }

  async function cancelStudio() {
    if (!els.cancelBtn || els.cancelBtn.dataset.busy === "1") return;
    const targetRunId = activeRunId;
    const targetPromptId = targetRunId ? promptByRunId.get(targetRunId) || null : null;
    cancelRequested = true;
    runGeneration += 1; // 作废进行中的出片等待，立刻允许再点执行
    stopStageMonitor();
    markStageCancelled(activeMonitorStage);
    activeRunId = null;
    activeMonitorStage = null;
    setBusy(false);
    els.cancelBtn.dataset.busy = "1";
    els.cancelBtn.disabled = true;
    showRunPanel(true);
    appendLog(
      targetPromptId
        ? `已取消。正在精确取消当前任务 ${String(targetPromptId).slice(0, 8)}…`
        : "已取消。当前任务尚未拿到 promptId，将按安全策略处理…"
    );
    window.AppCore?.setStatus?.("已取消");
    const cancelPayload = {
      runId: targetRunId || undefined,
      promptId: targetPromptId || undefined,
    };
    try {
      let result = await window.modelManager.cancelStudio?.(cancelPayload);
      if (result?.needsConfirmation) {
        const approved = window.confirm(
          `${result.message || "无法精确定位当前任务。"}\n\n确定继续全局取消？`
        );
        if (!approved) {
          appendLog("已放弃全局取消（未清空 ComfyUI 队列，避免误伤其他任务）");
          return;
        }
        result = await window.modelManager.cancelStudio?.({
          ...cancelPayload,
          forceGlobal: true,
        });
      }
      if (result?.ok) {
        appendLog(result.message || (result.precise ? "已精确取消当前任务" : "已取消"));
        if (targetRunId) promptByRunId.delete(targetRunId);
      } else {
        appendLog(`ComfyUI 取消未完全成功：${result?.error || "未知错误"}（可到后台点 Interrupt）`);
      }
    } catch (error) {
      appendLog(`取消失败：${error.message}`);
    } finally {
      els.cancelBtn.dataset.busy = "";
      els.cancelBtn.disabled = false;
      setBusy(false);
      try {
        await refreshEnv();
      } catch {
        // ignore
      }
    }
  }

  async function runStudio() {
    await persistFields();
    if (!pipeline.t2iWorkflow && !pipeline.i2vWorkflow) {
      appendLog("请先挂载文生图或图生视频工作流");
      return;
    }

    const command = "确认创作台出片";
    if (window.ButlerRisk && window.ButlerUI?.showConfirmModal) {
      const assessment = window.ButlerRisk.assess(command, 2);
      if (assessment.needsConfirm) {
        const approved = await window.ButlerUI.showConfirmModal({
          ...assessment,
          risk: {
            ...(assessment.risk || {}),
            title: "创作台出片确认",
            message: "将按挂载的工作流占用 GPU 出片，确认后开始。",
            detail: `人物：${pipeline.character || "—"}\n动作：${pipeline.action || "—"}\nT2I：${pipeline.t2iWorkflow || "—"}\nI2V：${pipeline.i2vWorkflow || "—"}`,
          },
        });
        if (!approved) return;
      }
    }

    const gen = ++runGeneration;
    const baseId = `studio-${Date.now()}`;
    activeRunId = baseId;
    cancelRequested = false;
    resetStageUi();
    showTip(false);
    showGuide(false);
    setBusy(true);

    let imagePath = pipeline.imagePath || "";
    let finalPath = "";
    let lastResult = null;
    const stillActive = () => gen === runGeneration && !cancelRequested;

    try {
      await window.modelManager.ensurePai();
      if (!stillActive()) return;

      if (pipeline.t2iWorkflow) {
        activeRunId = `${baseId}-t2i`;
        const t2iExpect = estimateSeconds(pipeline.t2iWorkflow, 60);
        startStageMonitor("t2i", t2iExpect);
        const promptPreview = [pipeline.character, pipeline.action].filter(Boolean).join("，");
        appendLog(`开始文生图：${pipeline.t2iWorkflow}（约 ${formatElapsed(t2iExpect)}）`);
        if (promptPreview) appendLog(`覆盖提示词：${promptPreview}`);
        if (pipeline.size) appendLog(`覆盖尺寸：${pipeline.size}`);
        if (pipeline.clarity) appendLog(`覆盖清晰度：${pipeline.clarity}`);
        if (pipeline.duration) appendLog(`覆盖时长：${formatDurationLabel(pipeline.duration)}`);
        let t2iResult;
        try {
          t2iResult = await invokeStudioStage({
            runId: activeRunId,
            character: pipeline.character,
            action: pipeline.action,
            image: pipeline.imagePath,
            t2i_workflow: pipeline.t2iWorkflow,
            i2v_workflow: "",
            open_jianying: false,
            tool: "none",
            level: 2,
            ...studioOverrideFields(),
          });
        } finally {
          stopStageMonitor();
        }
        if (!stillActive()) return;
        lastResult = t2iResult;
        if (!t2iResult?.ok) {
          const cancelled = isCancelledResult(t2iResult);
          setStageProgress("t2i", {
            phase: "failed",
            percent: 100,
            message: cancelled ? "已取消" : t2iResult?.error || "文生图失败",
          });
          appendLog(cancelled ? "已取消文生图" : `文生图失败：${t2iResult?.error || "未知错误"}`);
          return;
        }
        imagePath = pickOutputPath(t2iResult, "image") || t2iResult.image_path || t2iResult.path || imagePath;
        setStageProgress("t2i", { phase: "completed", percent: 100, message: "文生图完成" });
        if (imagePath) {
          await showStageMedia("t2i", imagePath);
          appendLog(`文生图完成：${imagePath}`);
        } else {
          appendLog("文生图完成，但未找到图片路径");
        }
        if (t2iResult.postTool?.message) appendLog(t2iResult.postTool.message);
        finalPath = imagePath;
      }

      if (!stillActive()) return;

      if (pipeline.i2vWorkflow) {
        activeRunId = `${baseId}-i2v`;
        const i2vExpect = estimateI2vSeconds(pipeline.i2vWorkflow, pipeline.duration);
        startStageMonitor("i2v", i2vExpect);
        appendLog(
          `开始图生视频：${pipeline.i2vWorkflow}（约 ${formatElapsed(i2vExpect)}）。请耐心等待；确需停止可点「取消」。也可打开 ComfyUI 后台查看。`
        );
        if (pipeline.duration) appendLog(`覆盖时长：${formatDurationLabel(pipeline.duration)}`);
        let i2vResult;
        try {
          i2vResult = await invokeStudioStage({
            runId: activeRunId,
            character: pipeline.character,
            action: pipeline.action,
            image: imagePath || pipeline.imagePath,
            t2i_workflow: "",
            i2v_workflow: pipeline.i2vWorkflow,
            open_jianying: false,
            tool: "none",
            level: 2,
            ...studioOverrideFields(),
          });
        } finally {
          stopStageMonitor();
        }
        if (!stillActive()) return;
        lastResult = i2vResult;
        if (!i2vResult?.ok) {
          const cancelled = isCancelledResult(i2vResult);
          setStageProgress("i2v", {
            phase: "failed",
            percent: 100,
            message: cancelled ? "已取消" : i2vResult?.error || "图生视频失败",
          });
          appendLog(cancelled ? "已取消图生视频" : `图生视频失败：${i2vResult?.error || "未知错误"}`);
          return;
        }
        const videoPath = pickOutputPath(i2vResult, "video") || i2vResult.path || "";
        setStageProgress("i2v", { phase: "completed", percent: 100, message: "图生视频完成" });
        if (videoPath) {
          await showStageMedia("i2v", videoPath);
          appendLog(`图生视频完成：${videoPath}`);
          appendLog("短片已就绪。需要拼长片请到左侧「视频合成」。");
          finalPath = videoPath;
        } else {
          appendLog("图生视频完成，但未找到视频路径");
        }
      }

      if (!stillActive()) return;
      appendLog(finalPath ? `全部完成：${finalPath}` : lastResult?.message || "全部完成");
    } catch (error) {
      stopStageMonitor();
      if (!stillActive()) return;
      const cancelled = isCancelledResult(null, error);
      appendLog(cancelled ? "已取消" : `错误：${error.message}`);
      const failMsg = cancelled ? "已取消" : error.message;
      if (pipeline.t2iWorkflow && !imagePath) {
        setStageProgress("t2i", { phase: "failed", percent: 100, message: failMsg });
      } else if (pipeline.i2vWorkflow) {
        setStageProgress("i2v", { phase: "failed", percent: 100, message: failMsg });
      }
    } finally {
      // 仅本轮仍有效时恢复；取消后已提前解锁，避免旧请求返回再把状态弄乱
      if (gen === runGeneration) {
        stopStageMonitor();
        activeRunId = null;
        activeMonitorStage = null;
        cancelRequested = false;
        setBusy(false);
        try {
          await refreshEnv();
        } catch {
          // ignore
        }
      }
    }
  }

  function showProgress(_progress) {
    // 阶段进度改由 startStageMonitor 驱动，忽略旧的整包进度事件以免互相覆盖
  }

  function appendLog(line) {
    if (!els.log) return;
    showTip(false);
    showGuide(false);
    showRunPanel(true);
    const stamp = new Date().toLocaleTimeString();
    els.log.textContent = `${els.log.textContent}\n[${stamp}] ${line}`.trim();
  }

  function setBusy(busy) {
    if (els.runBtn) els.runBtn.disabled = busy;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/'/g, "&#39;");
  }

  return { init };
})();

window.StudioPanel = StudioPanel;

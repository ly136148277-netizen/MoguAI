const ButlerUI = (() => {
  const els = {};
  let activeRunId = null;
  let progressUnsubscribe = null;

  const LEVEL_META = {
    1: {
      label: "L1 只读/启动",
      tip: "L1 只读/启动：打开 ComfyUI/Ollama、搜索文件、列出工作流、抓取网页。不下载、不备份、不删除。",
    },
    2: {
      label: "L2 下载/ComfyUI",
      tip: "L2 下载/ComfyUI：含 L1，另可下载、备份恢复、ComfyUI 出片与管理、更新软件。日常推荐。",
    },
    3: {
      label: "L3 删除/批量",
      tip: "L3 删除/批量：含 L2，另可删除白名单内文件、批量移动/删除。危险操作，请谨慎。",
    },
  };

  function init() {
    els.statusDot = document.getElementById("butler-status-dot");
    els.statusText = document.getElementById("butler-status-text");
    els.messages = document.getElementById("butler-messages");
    els.form = document.getElementById("butler-form");
    els.input = document.getElementById("butler-input");
    els.level = document.getElementById("butler-level");
    els.levelTrigger = document.getElementById("butler-level-trigger");
    els.levelMenu = document.getElementById("butler-level-menu");
    els.levelLabel = document.getElementById("butler-level-label");
    els.ensureBtn = document.getElementById("butler-ensure-btn");
    els.doctorBtn = document.getElementById("butler-doctor-btn");
    els.scanEnvBtn = document.getElementById("butler-scan-env-btn");
    els.confirmModal = document.getElementById("butler-confirm-modal");
    els.confirmTitle = document.getElementById("butler-confirm-title");
    els.confirmMessage = document.getElementById("butler-confirm-message");
    els.confirmDetail = document.getElementById("butler-confirm-detail");
    els.confirmOk = document.getElementById("butler-confirm-ok");
    els.confirmCancel = document.getElementById("butler-confirm-cancel");
    els.progressWrap = document.getElementById("butler-progress");
    els.progressFill = document.getElementById("butler-progress-fill");
    els.progressText = document.getElementById("butler-progress-text");

    initLevelPicker();
    initConfirmModal();
    initProgressListener();
    initPermissionBridge();
    window.modelManager?.permissionUiReady?.().catch(() => {});

    els.form.addEventListener("submit", handleSubmit);
    els.ensureBtn.addEventListener("click", () => ensurePai(true));
    els.doctorBtn.addEventListener("click", runDoctor);
    els.scanEnvBtn.addEventListener("click", runEnvScan);

    document.querySelectorAll("[data-butler-cmd]").forEach((button) => {
      button.addEventListener("click", () => {
        els.input.value = button.dataset.butlerCmd;
        els.form.requestSubmit();
      });
    });

    window.AppRouter.onPage("butler", onPageEnter);
  }

  /** Agent 页复用同一套消息渲染时切换目标容器 */
  function bindMessages(el) {
    if (el) {
      els.messages = el;
    } else {
      els.messages = document.getElementById("butler-messages");
    }
  }

  function initLevelPicker() {
    els.levelTrigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (els.levelTrigger.disabled) {
        return;
      }
      const open = els.levelMenu.classList.toggle("hidden");
      els.levelTrigger.setAttribute("aria-expanded", open ? "false" : "true");
    });

    els.levelMenu.querySelectorAll(".butler-level__option").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const { value } = button.dataset;
        setLevelValue(value);
        closeLevelMenu();
      });
    });

    document.addEventListener("click", closeLevelMenu);
  }

  function setLevelValue(value) {
    const meta = LEVEL_META[value] || LEVEL_META[2];
    els.level.value = value;
    els.levelLabel.textContent = meta.label;
    els.levelTrigger.title = meta.tip;
    els.levelMenu.querySelectorAll(".butler-level__option").forEach((option) => {
      option.classList.toggle("is-selected", option.dataset.value === String(value));
    });
  }

  function closeLevelMenu() {
    if (!els.levelMenu) {
      return;
    }
    els.levelMenu.classList.add("hidden");
    els.levelTrigger?.setAttribute("aria-expanded", "false");
  }

  function initConfirmModal() {
    if (!els.confirmModal) {
      return;
    }

    els.confirmCancel?.addEventListener("click", () => hideConfirmModal(false));
    els.confirmModal.querySelector('[data-action="close-butler-confirm"]')?.addEventListener("click", () => hideConfirmModal(false));

    els.confirmOk?.addEventListener("click", () => {
      if (typeof els.confirmModal._resolve === "function") {
        els.confirmModal._resolve(true);
      }
    });
  }

  function initPermissionBridge() {
    if (!window.modelManager?.onPermissionRequest) return;
    window.modelManager.onPermissionRequest(async (req) => {
      if (!req?.requestId) return;
      const riskLevel = Number(req.riskLevel) || 2;
      const actionText = `${req.tool || ""} ${req.action || ""}`.trim();
      const assessment = {
        risk:
          (window.ButlerRisk?.describeRisk?.(riskLevel, req.action || actionText) || null) || {
            title: req.title || (riskLevel >= 3 ? "危险操作，需确认" : "需要你确认后继续"),
            message:
              riskLevel >= 3
                ? "此操作可能删除或严重改动文件。点确认才会执行；点取消则什么都不做。"
                : "此操作会改动本机文件或调用外置引擎。点确认才会执行；点取消则什么都不做。",
            detail: `${req.tool || ""}\n${req.action || ""}`.trim(),
            confirmLabel: riskLevel >= 3 ? "确认执行（危险）" : "确认执行",
            severity: riskLevel >= 3 ? "high" : "medium",
            nextHint: "不确定就取消，改用只读查询或到任务中心查看历史。",
          },
      };
      const approved = await showConfirmModal(assessment);
      try {
        await window.modelManager.respondPermission({
          requestId: req.requestId,
          allowed: approved === true,
          reason: approved ? "ui_approved" : "ui_denied",
        });
      } catch {
        // ignore
      }
    });
  }

  function showConfirmModal(assessment) {
    return new Promise((resolve) => {
      // Fail closed: missing modal/UI must never auto-approve L2/L3.
      if (!els.confirmModal || !assessment?.risk) {
        resolve(false);
        return;
      }

      const { risk } = assessment;
      els.confirmTitle.textContent = risk.title || "确认执行";
      els.confirmMessage.textContent = risk.message || "确认继续执行该指令？";
      const detailBits = [risk.detail || ""];
      if (risk.nextHint) detailBits.push(`下一步建议：${risk.nextHint}`);
      els.confirmDetail.textContent = detailBits.filter(Boolean).join("\n\n");
      els.confirmOk.textContent = risk.confirmLabel || "确认执行";
      els.confirmOk.classList.toggle("btn--danger", risk.severity === "high");
      els.confirmOk.classList.toggle("btn--primary", risk.severity !== "high");

      els.confirmModal._resolve = (approved) => {
        els.confirmModal._resolve = null;
        els.confirmModal.classList.add("hidden");
        resolve(approved);
      };

      els.confirmModal.classList.remove("hidden");
    });
  }

  function initProgressListener() {
    if (!window.modelManager?.onPaiRunProgress) {
      return;
    }
    progressUnsubscribe = window.modelManager.onPaiRunProgress((payload) => {
      if (!payload || (activeRunId && payload.runId !== activeRunId)) {
        return;
      }
      updateProgressBanner(payload);
    });
  }

  function shouldTrackProgress(command) {
    const text = String(command || "").trim();
    if (window.ButlerRisk?.isWorkflowRun?.(text)) {
      return true;
    }
    return /^确认出片/i.test(text);
  }

  function updateProgressBanner(progress) {
    if (!els.progressWrap) {
      return;
    }
    els.progressWrap.classList.remove("hidden");
    if (els.progressText) {
      els.progressText.textContent = progress.message || "ComfyUI 处理中…";
    }
    if (els.progressFill) {
      const phase = progress.phase || "running";
      els.progressFill.classList.toggle("is-indeterminate", phase === "running" || phase === "submitting" || phase === "queued");
      els.progressFill.classList.toggle("is-complete", phase === "completed");
      els.progressFill.classList.toggle("is-failed", phase === "failed");
    }
    if (progress.done) {
      window.setTimeout(() => els.progressWrap?.classList.add("hidden"), 4000);
    }
  }

  function hideProgressBanner() {
    els.progressWrap?.classList.add("hidden");
  }

  function hideConfirmModal(approved) {
    if (typeof els.confirmModal?._resolve === "function") {
      els.confirmModal._resolve(approved);
    }
  }

  function mainOwnsPermissionUi() {
    return Boolean(window.modelManager?.onPermissionRequest && window.modelManager?.respondPermission);
  }

  async function runCommand(text, options = {}) {
    const level = Number(options.level ?? els.level.value) || 2;
    const displayText = options.displayText ?? text;
    const mainGate = mainOwnsPermissionUi();

    if (!options.skipRiskCheck && window.ButlerRisk) {
      const assessment = window.ButlerRisk.assess(text, level);
      if (assessment.needsConfirm) {
        if (assessment.suggestedLevel > level) {
          setLevelValue(String(assessment.suggestedLevel));
        }
        // Real confirm is owned by main-process PermissionProxy (fail-closed).
        // Keep local modal only as legacy fallback when preload bridge is missing.
        if (!mainGate) {
          const approved = await showConfirmModal(assessment);
          if (!approved) {
            appendMessage("system", "已取消执行");
            return null;
          }
        }
        text = assessment.confirmedCommand || text;
      }
    }

    if (!options.silentUserMessage) {
      appendMessage("user", displayText);
    }
    setBusy(true);

    try {
      const runLevel = Number(els.level.value) || level;
      await ensurePai(false);

      let result;
      if (shouldTrackProgress(text) && window.modelManager.runPaiCommandTracked) {
        activeRunId = options.runId || `butler-${Date.now()}`;
        updateProgressBanner({ phase: "submitting", message: "正在提交出片任务…" });
        const tracked = await window.modelManager.runPaiCommandTracked({
          command: text,
          level: runLevel,
          runId: activeRunId,
        });
        result = tracked?.result || tracked;
        activeRunId = null;
      } else {
        result = await window.modelManager.runPaiCommand({ command: text, level: runLevel });
      }

      if (result?.permissionDenied) {
        appendMessage("assistant", `⛔ ${result.error || result.message || "权限已拒绝"}`, { error: true });
        window.AppCore.setStatus("权限已拒绝");
        return result;
      }

      if (!options.skipPaiConfirm && window.ButlerRisk) {
        const paiAssessment = window.ButlerRisk.assessPaiResponse(text, result);
        if (paiAssessment) {
          if (!mainGate) {
            const approved = await showConfirmModal(paiAssessment);
            if (!approved) {
              appendMessage("system", "已取消执行");
              return null;
            }
          }
          setBusy(false);
          return runCommand(paiAssessment.confirmedCommand || text, {
            level: Math.max(runLevel, paiAssessment.suggestedLevel || 2),
            skipRiskCheck: true,
            skipPaiConfirm: true,
            silentUserMessage: true,
            displayText: `${displayText}（已确认）`,
          });
        }
      }

      appendMessage("assistant", formatResult(result), {
        capability: result.capability,
        ok: result.ok,
        elapsed_ms: result.elapsed_ms,
      });
      window.AppCore.setStatus(result.ok ? "管家指令已执行" : "管家指令失败");
      return result;
    } catch (error) {
      appendMessage("assistant", `❌ ${error.message}`, { error: true });
      return null;
    } finally {
      setBusy(false);
      hideProgressBanner();
      activeRunId = null;
      await refreshStatus();
    }
  }

  async function onPageEnter() {
    bindMessages(document.getElementById("butler-messages"));
    await refreshStatus();
    const prefill = sessionStorage.getItem("butlerPrefill");
    if (prefill != null) {
      sessionStorage.removeItem("butlerPrefill");
      els.input.value = prefill;
    }
    els.input.focus();
  }

  async function refreshStatus() {
    try {
      const status = await window.modelManager.getPaiStatus();
      if (!status.installed) {
        setStatusUi("offline", `PAI 未安装：${status.pythonPath}`);
        return;
      }
      if (status.running) {
        setStatusUi("online", `PAI 已就绪 · ${status.apiUrl}`);
        return;
      }
      setStatusUi("stopped", "PAI 未运行 · 点击「连接 PAI」或发送指令自动启动");
    } catch (error) {
      setStatusUi("offline", `状态检测失败：${error.message}`);
    }
  }

  function setStatusUi(state, text) {
    els.statusText.textContent = text;
    els.statusDot.classList.remove("butler-status__dot--online", "butler-status__dot--stopped", "butler-status__dot--offline");
    if (state === "online") {
      els.statusDot.classList.add("butler-status__dot--online");
    } else if (state === "stopped") {
      els.statusDot.classList.add("butler-status__dot--stopped");
    } else {
      els.statusDot.classList.add("butler-status__dot--offline");
    }
  }

  async function ensurePai(showToast) {
    try {
      setStatusUi("stopped", "正在连接 PAI…");
      await window.modelManager.ensurePai();
      await refreshStatus();
      if (showToast) {
        window.AppCore.setStatus("PAI 已连接");
      }
    } catch (error) {
      setStatusUi("offline", error.message);
      if (showToast) {
        window.AppCore.setStatus(`连接 PAI 失败：${error.message}`);
      }
      throw error;
    }
  }

  async function runDoctor() {
    appendMessage("user", "检测 PAI 健康状态");
    setBusy(true);
    try {
      await ensurePai(false);
      const data = await window.modelManager.runPaiDoctor();
      appendMessage("assistant", formatDoctor(data), { capability: "doctor" });
      window.AppCore.setStatus("PAI 检测完成");
    } catch (error) {
      appendMessage("assistant", `❌ ${error.message}`, { error: true });
    } finally {
      setBusy(false);
      await refreshStatus();
    }
  }

  async function runEnvScan() {
    appendMessage("user", "一键识别本机环境");
    setBusy(true);
    try {
      setStatusUi("stopped", "正在扫描本机环境…");
      const data = await window.modelManager.scanLocalEnvironment();
      appendEnvScanReport(data);
      window.AppCore.setStatus("本机环境识别完成");
    } catch (error) {
      appendMessage("assistant", `❌ ${error.message}`, { error: true });
    } finally {
      setBusy(false);
      await refreshStatus();
    }
  }

  async function applyComfyUiConfig(comfyui) {
    setBusy(true);
    try {
      const result = await window.modelManager.applyComfyUiConfig({ comfyui });
      appendMessage(
        "assistant",
        `✅ 已写入 PAI 配置\nComfyUI 路径：${result.path}\nAPI：${result.api}`,
        { capability: "env_apply" }
      );
      window.AppCore.setStatus("ComfyUI 配置已写入 PAI");
    } catch (error) {
      appendMessage("assistant", `❌ 写入失败：${error.message}`, { error: true });
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const text = els.input.value.trim();
    if (!text) {
      return;
    }

    els.input.value = "";
    await runCommand(text);
  }

  function setBusy(busy) {
    if (els.input) els.input.disabled = busy;
    const submit = els.form?.querySelector('button[type="submit"]');
    if (submit) submit.disabled = busy;
    if (els.levelTrigger) els.levelTrigger.disabled = busy;
    if (els.scanEnvBtn) {
      els.scanEnvBtn.disabled = busy;
    }
    if (els.ensureBtn) {
      els.ensureBtn.disabled = busy;
    }
    if (els.doctorBtn) {
      els.doctorBtn.disabled = busy;
    }
    if (busy) {
      closeLevelMenu();
    }
  }

  function appendEnvScanReport(data) {
    const item = document.createElement("article");
    item.className = "butler-message butler-message--assistant";

    const needApply = shouldOfferComfyUiApply(data);
    const body = formatEnvScan(data);
    let actionsHtml = "";
    if (needApply && data.comfyui?.best) {
      actionsHtml = `<div class="butler-message__actions"><button type="button" class="btn btn--primary btn--tiny butler-apply-comfyui">写入 ComfyUI 到 PAI 配置</button></div>`;
    }

    item.innerHTML = `
      <div class="butler-message__body">${escapeHtml(body).replace(/\n/g, "<br>")}</div>
      <div class="butler-message__meta">本机环境报告</div>
      ${actionsHtml}
    `;

    const applyBtn = item.querySelector(".butler-apply-comfyui");
    if (applyBtn && data.comfyui?.best) {
      applyBtn.addEventListener("click", () => applyComfyUiConfig(data.comfyui.best));
    }

    els.messages.appendChild(item);
    scrollToBottom();
  }

  function shouldOfferComfyUiApply(data) {
    const best = data?.comfyui?.best;
    const configured = data?.comfyui?.configured;
    if (!best?.path || !data?.pai?.installed) {
      return false;
    }
    if (!configured?.path) {
      return true;
    }
    return configured.path.replace(/\\/g, "/").toLowerCase() !== best.path.replace(/\\/g, "/").toLowerCase();
  }

  function formatEnvScan(data) {
    const lines = ["📋 本机环境识别报告", ""];

    const { summary, ollama, comfyui, pai, doctor, appScan, drives } = data;

    lines.push("—— 总览 ——");
    lines.push(`AI 聊天：${summary.readyForChat ? "✅ 就绪" : "⚠ 未就绪"}`);
    lines.push(`AI 管家：${summary.readyForButler ? "✅ 就绪" : "⚠ 未就绪"}`);
    lines.push(`ComfyUI：${summary.readyForComfyui ? "✅ API 已连接" : "⚠ 未连接或未找到"}`);
    lines.push(`磁盘：${(drives || []).join(" ")}`);
    lines.push("");

    lines.push("—— Ollama ——");
    if (ollama.installed) {
      lines.push(`✅ 已安装 ${ollama.version || ""} · ${ollama.running ? "运行中" : "未运行"}`);
      lines.push(`模型数量：${ollama.modelCount}`);
      if (ollama.home) {
        lines.push(`目录：${ollama.home}`);
      }
    } else {
      lines.push("⚠ 未安装 Ollama");
    }
    lines.push("");

    lines.push("—— ComfyUI ——");
    if (comfyui.best) {
      const c = comfyui.best;
      lines.push(`✅ 找到：${c.path}`);
      lines.push(`类型：${c.portable ? "便携版" : "标准安装"}`);
      lines.push(`API：${c.apiUrl} · ${c.running ? "运行中" : "未运行"}`);
      if (comfyui.candidates.length > 1) {
        lines.push(`（共扫描到 ${comfyui.candidates.length} 个候选目录）`);
      }
    } else {
      lines.push("⚠ 未在常见位置找到 ComfyUI");
    }
    if (comfyui.configured?.path) {
      lines.push(`PAI 当前配置：${comfyui.configured.path}`);
    }
    lines.push("");

    lines.push("—— PAI 管家 ——");
    if (pai.installed) {
      lines.push(`✅ 已安装 · ${pai.root}`);
      lines.push(`服务：${pai.running ? "运行中" : "未运行"} · ${pai.apiUrl}`);
    } else {
      lines.push(`⚠ 未找到 PAI：${pai.pythonPath || pai.root}`);
    }

    if (appScan && !appScan.skipped) {
      lines.push("");
      lines.push("—— 本机软件 ——");
      if (appScan.ok) {
        lines.push(`✅ 已扫描约 ${appScan.appCount} 个可启动项`);
        if (appScan.comfyuiApps?.length) {
          lines.push(`ComfyUI 相关：${appScan.comfyuiApps.join(" · ")}`);
        }
      } else {
        lines.push(`⚠ 软件扫描未完成：${appScan.reason || "未知错误"}`);
      }
    }

    if (doctor?.results?.length) {
      lines.push("");
      lines.push("—— Doctor 抽检 ——");
      for (const row of doctor.results.slice(0, 8)) {
        const icon = row.status === "ok" ? "✅" : row.status === "fail" ? "❌" : "⚠";
        lines.push(`${icon} ${row.name}: ${row.message}`);
      }
      if (doctor.results.length > 8) {
        lines.push(`… 另有 ${doctor.results.length - 8} 项，可点「检测健康」查看全部`);
      }
    } else if (doctor?.error) {
      lines.push("");
      lines.push(`Doctor：⚠ ${doctor.error}`);
    }

    if (summary.issues?.length) {
      lines.push("");
      lines.push("—— 建议 ——");
      for (const issue of summary.issues) {
        lines.push(`· ${issue}`);
      }
    }

    return lines.join("\n");
  }

  function appendMessage(role, content, meta = {}) {
    const item = document.createElement("article");
    item.className = `butler-message butler-message--${role}${meta.error ? " butler-message--error" : ""}`;

    let metaHtml = "";
    if (meta.capability) {
      const elapsed = meta.elapsed_ms != null ? ` · ${meta.elapsed_ms}ms` : "";
      metaHtml = `<div class="butler-message__meta">${meta.capability}${elapsed}${meta.ok === false ? " · 失败" : ""}</div>`;
    }

    item.innerHTML = `
      <div class="butler-message__body">${escapeHtml(content).replace(/\n/g, "<br>")}</div>
      ${metaHtml}
    `;
    els.messages.appendChild(item);
    scrollToBottom();
  }

  function formatResult(data) {
    if (!data) {
      return "无响应";
    }
    if (data.error) {
      let text = `❌ ${data.error}`;
      if (data.hint) {
        text += `\n提示：${data.hint}`;
      }
      if (data.reason) {
        text += `\n路由：${data.reason}`;
      }
      return text;
    }

    const lines = [];
    if (data.capability) {
      lines.push(`✅ ${data.capability}${data.elapsed_ms != null ? ` · ${data.elapsed_ms}ms` : ""}`);
    }
    if (data.reason) {
      lines.push(`路由：${data.reason}`);
    }

    for (const key of ["message", "reply", "summary", "stdout", "path", "output", "detail"]) {
      if (data[key]) {
        lines.push(String(data[key]));
      }
    }

    if (data.results && Array.isArray(data.results)) {
      lines.push(data.results.map((r) => `${r.name || r.status}: ${r.message || ""}`).join("\n"));
    }

    if (lines.length <= 1) {
      const copy = { ...data };
      delete copy.ok;
      delete copy.capability;
      delete copy.reason;
      delete copy.elapsed_ms;
      delete copy.model;
      const rest = Object.keys(copy);
      if (rest.length) {
        lines.push(JSON.stringify(copy, null, 2));
      }
    }

    return lines.join("\n") || "✅ 完成";
  }

  function formatDoctor(data) {
    const rows = data?.results || [];
    if (!rows.length) {
      return "未返回检测结果";
    }
    return rows.map((r) => `${r.status === "ok" ? "✅" : "⚠"} ${r.name}: ${r.message}`).join("\n");
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      els.messages.scrollTop = els.messages.scrollHeight;
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { init, runCommand, showConfirmModal, bindMessages };
})();

window.ButlerUI = ButlerUI;

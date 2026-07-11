const MyModelsPage = (() => {
  const els = {};
  let installedModels = [];
  let recentDownloadMap = new Map();
  const importErrors = new Map();

  function init() {
    els.statsInstalled = document.getElementById("my-stats-installed");
    els.statsImported = document.getElementById("my-stats-imported");
    els.statsSize = document.getElementById("my-stats-size");
    els.list = document.getElementById("my-model-list");
    els.content = document.getElementById("my-models-content");
    els.empty = document.getElementById("my-models-empty");
    els.gotoStoreBtn = document.getElementById("my-goto-models-btn");

    els.list.addEventListener("click", handleListClick);
    els.gotoStoreBtn.addEventListener("click", () => window.AppRouter.navigate("models"));

    window.modelManager.onDownloadProgress(() => refreshIfActive());
    window.modelManager.onDownloadComplete(() => refreshIfActive());
    window.modelManager.onDownloadError(() => refreshIfActive());
    window.modelManager.onOllamaImportProgress(() => refreshIfActive());
    window.modelManager.onOllamaImportComplete((payload) => {
      if (payload?.modelId) {
        importErrors.delete(payload.modelId);
      }
      refreshIfActive();
    });
    window.modelManager.onOllamaImportError((payload) => {
      importErrors.set(payload.modelId, payload.message || "导入失败");
      refreshIfActive();
    });
    window.modelManager.onOllamaRemoved(() => {
      refreshIfActive();
    });
  }

  function refreshIfActive() {
    if (window.AppRouter.getCurrentPage() === "my-models") {
      load();
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function formatParamCount(paramCount) {
    if (!paramCount) return "未知";
    if (paramCount >= 1_000_000_000) {
      const value = paramCount / 1_000_000_000;
      return `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/, "")}B`;
    }
    if (paramCount >= 1_000_000) {
      return `${Math.round(paramCount / 1_000_000)}M`;
    }
    return String(paramCount);
  }

  function extractQuantization(model) {
    const tags = model.tags || [];
    const fromTag = tags.find((tag) => /^Q\d/i.test(tag) || /Q\d_K_\w+/i.test(tag));
    if (fromTag) return fromTag;

    const match = model.filename?.match(/(Q\d+(?:_K_\w+)?)/i);
    return match ? match[1].toUpperCase() : "未知";
  }

  function formatDownloadTime(modelId) {
    const downloadedAt = recentDownloadMap.get(modelId);
    if (!downloadedAt) return null;
    try {
      return new Date(downloadedAt).toLocaleString();
    } catch {
      return downloadedAt;
    }
  }

  function getDownloadState(modelId) {
    return window.AppCore?.getDownloadState?.(modelId) || null;
  }

  function getImportState(modelId) {
    if (importErrors.has(modelId)) {
      return { stage: "failed", message: importErrors.get(modelId) };
    }
    return window.AppCore?.getImportState?.(modelId) || null;
  }

  function isModelVisible(model) {
    const progress = getDownloadState(model.id);
    const downloading = progress && ["downloading", "starting", "verifying", "retrying", "waiting", "paused"].includes(progress.status);
    return model.downloaded || model.ollamaImported || downloading || importErrors.has(model.id);
  }

  function resolveStatus(model) {
    const progress = getDownloadState(model.id);
    const importing = getImportState(model.id);
    const statuses = [];

    if (progress && ["downloading", "starting", "verifying", "retrying", "waiting"].includes(progress.status)) {
      statuses.push({ key: "downloading", label: "⬇ 下载中", className: "my-status--downloading" });
    } else if (progress?.status === "paused") {
      statuses.push({ key: "paused", label: "⬇ 已暂停", className: "my-status--downloading" });
    }

    if (importing?.stage === "failed") {
      statuses.push({ key: "import-failed", label: "⚠ 导入失败", className: "my-status--failed" });
    } else if (importing && !["completed", "skipped"].includes(importing.stage)) {
      statuses.push({ key: "importing", label: "正在导入 Ollama...", className: "my-status--importing" });
    }

    if (model.downloaded) {
      statuses.push({ key: "downloaded", label: "✅ 已下载", className: "my-status--ok" });
    }

    if (model.ollamaImported) {
      statuses.push({ key: "imported", label: "✅ 已导入 Ollama", className: "my-status--ok" });
    }

    return statuses;
  }

  function renderStatusBadges(statuses) {
    if (!statuses.length) {
      return `<span class="my-status my-status--muted">暂无状态</span>`;
    }
    return statuses.map((item) => `<span class="my-status ${item.className}">${item.label}</span>`).join("");
  }

  function renderCard(model) {
    const statuses = resolveStatus(model);
    const downloadTime = formatDownloadTime(model.id);
    const importError = importErrors.get(model.id);
    const storagePath = model.localPath || "—";
    const hasLocalFile = Boolean(model.localPath || model.downloaded);
    const canChat = model.ollamaImported;
    const canOpenDir = hasLocalFile || model.ollamaImported;
    const canReimport = hasLocalFile || model.ollamaImported;
    const canDelete = model.downloaded || model.ollamaImported;

    return `
      <article class="my-model-card" data-model-id="${model.id}">
        <div class="my-model-card__head">
          <div>
            <h3 class="my-model-card__title">${escapeHtml(model.name)}</h3>
            <div class="my-model-card__statuses">${renderStatusBadges(statuses)}</div>
          </div>
          <span class="my-model-card__size">${model.size || formatBytes(model.localSizeBytes)}</span>
        </div>
        ${importError ? `<p class="my-model-card__error">导入失败：${escapeHtml(importError)}</p>` : ""}
        ${model.fileInLegacyDir ? `<p class="my-model-card__hint">文件在旧保存目录，仍可导入；可在「模型保存位置」改回或重新下载到新目录。</p>` : ""}
        <dl class="my-model-card__meta">
          <div><dt>参数规模</dt><dd>${formatParamCount(model.paramCount)}</dd></div>
          <div><dt>量化版本</dt><dd>${escapeHtml(extractQuantization(model))}</dd></div>
          <div><dt>文件大小</dt><dd>${formatBytes(model.localSizeBytes || model.sizeBytes)}</dd></div>
          <div class="my-model-card__path"><dt>存储路径</dt><dd title="${escapeHtml(storagePath)}">${escapeHtml(storagePath)}</dd></div>
          ${downloadTime ? `<div><dt>下载时间</dt><dd>${escapeHtml(downloadTime)}</dd></div>` : ""}
        </dl>
        <div class="my-model-card__actions">
          <button type="button" class="btn btn--primary" data-action="my-chat" data-id="${model.id}" ${canChat ? "" : "disabled"}>💬 开始聊天</button>
          <button type="button" class="btn btn--primary" data-action="my-open-dir" data-id="${model.id}" ${canOpenDir ? "" : "disabled"}>📂 打开模型目录</button>
          <button type="button" class="btn btn--primary" data-action="my-reimport" data-id="${model.id}" ${canReimport ? "" : "disabled"}>🔄 重新导入 Ollama</button>
          <button type="button" class="btn btn--danger" data-action="my-delete" data-id="${model.id}" ${canDelete ? "" : "disabled"}>🗑 删除模型</button>
        </div>
      </article>
    `;
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateStats(models) {
    const downloaded = models.filter((item) => item.downloaded).length;
    const imported = models.filter((item) => item.ollamaImported).length;
    const totalBytes = models.reduce((sum, item) => sum + (item.localSizeBytes || 0), 0);

    els.statsInstalled.textContent = String(downloaded);
    els.statsImported.textContent = String(imported);
    els.statsSize.textContent = formatBytes(totalBytes);
  }

  function renderList(models) {
    if (!models.length) {
      els.content.classList.add("hidden");
      els.empty.classList.remove("hidden");
      els.list.innerHTML = "";
      updateStats([]);
      return;
    }

    els.content.classList.remove("hidden");
    els.empty.classList.add("hidden");
    els.list.innerHTML = models.map(renderCard).join("");
    updateStats(models);
  }

  async function load() {
    try {
      const [models, settings] = await Promise.all([
        window.modelManager.listModels({}),
        window.modelManager.getSettings(),
      ]);

      window.AppCore?.setCachedModels?.(models);
      window.ChatUI.renderReadyModels(models);

      recentDownloadMap = new Map((settings.recentDownloads || []).map((item) => [item.modelId, item.downloadedAt]));
      installedModels = models.filter(isModelVisible);
      renderList(installedModels);
    } catch (error) {
      els.content.classList.remove("hidden");
      els.empty.classList.add("hidden");
      els.list.innerHTML = `<div class="error-state">加载失败：${escapeHtml(error.message)}</div>`;
    }
  }

  function findModel(modelId) {
    return installedModels.find((item) => item.id === modelId);
  }

  async function handleChat(modelId) {
    await window.AppCore.openChatWithModel(modelId);
  }

  async function handleOpenDir(model) {
    if (!model) {
      return;
    }
    try {
      if (model.localPath) {
        const dir = model.localPath.replace(/[\\/][^\\/]+$/, "");
        await window.modelManager.openStoragePath(dir || model.localPath);
      } else {
        await window.modelManager.openStoragePath();
      }
      window.AppCore.setStatus("已打开模型目录");
    } catch (error) {
      window.AppCore.setStatus(`打开目录失败：${error.message}`);
    }
  }

  async function handleReimport(modelId) {
    const model = findModel(modelId);
    if (!model) {
      return;
    }

    try {
      importErrors.delete(modelId);
      window.AppCore.setImportState(modelId, { stage: "starting", message: "正在重新导入..." });
      refreshIfActive();

      const status = await window.modelManager.getOllamaStatus();
      if (!status.running) {
        throw new Error("Ollama 未运行，请先点击顶部「启动 Ollama」");
      }

      await window.modelManager.importToOllama(modelId, { force: true });
      window.AppCore.setStatus(`正在重新导入 ${model.name}...`);
    } catch (error) {
      importErrors.set(modelId, error.message || "导入失败");
      window.AppCore.clearImportState(modelId);
      window.AppCore.setStatus(`重新导入失败：${error.message}`);
      refreshIfActive();
    }
  }

  async function handleDelete(modelId) {
    const model = findModel(modelId);
    if (!model) return;

    const confirmed = confirm(`确定删除模型「${model.name}」吗？\n\n将删除本地 GGUF 文件、Modelfile，并从 Ollama 中移除（如已导入）。`);
    if (!confirmed) return;

    try {
      await window.modelManager.deleteModel(modelId);
      importErrors.delete(modelId);
      window.AppCore.clearImportState(modelId);
      window.AppCore.setStatus(`已删除 ${model.name}`);
      await load();
      await window.AppCore.refreshAll();
    } catch (error) {
      window.AppCore.setStatus(`删除失败：${error.message}`);
    }
  }

  function handleListClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;

    const modelId = button.dataset.id;
    const action = button.dataset.action;

    if (action === "my-chat") handleChat(modelId);
    else if (action === "my-open-dir") handleOpenDir(findModel(modelId));
    else if (action === "my-reimport") handleReimport(modelId);
    else if (action === "my-delete") handleDelete(modelId);
  }

  function clearImportError(modelId) {
    importErrors.delete(modelId);
  }

  return { init, load, refreshIfActive, clearImportError };
})();

window.MyModelsPage = MyModelsPage;

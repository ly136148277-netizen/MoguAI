const modelListEl = document.getElementById("model-list");
const modelCountEl = document.getElementById("model-count");
const queueListEl = document.getElementById("queue-list");
const queueCountEl = document.getElementById("queue-count");
const storagePathEl = document.getElementById("storage-path");
const statusTextEl = document.getElementById("status-text");
const refreshBtn = document.getElementById("refresh-btn");
const changeStorageBtn = document.getElementById("change-storage-btn");
const storagePathModalEl = document.getElementById("storage-path-modal");
const storagePathInputEl = document.getElementById("storage-path-input");
const storageDriveListEl = document.getElementById("storage-drive-list");
const storagePathBrowseBtn = document.getElementById("storage-path-browse-btn");
const storagePathCancelBtn = document.getElementById("storage-path-cancel-btn");
const storagePathConfirmBtn = document.getElementById("storage-path-confirm-btn");
const ollamaStatusEl = document.getElementById("ollama-status");
const ollamaStatusTextEl = document.getElementById("ollama-status-text");
const ollamaStartBtn = document.getElementById("ollama-start-btn");
const ollamaInstallBtn = document.getElementById("ollama-install-btn");
const searchInputEl = document.getElementById("search-input");
const filterSelectEl = document.getElementById("filter-select");
const categorySelectEl = document.getElementById("category-select");
const tagSelectEl = document.getElementById("tag-select");
const sortSelectEl = document.getElementById("sort-select");
const syncBtn = document.getElementById("sync-btn");
const settingsFormEl = document.getElementById("settings-form");
const settingThreadsEl = document.getElementById("setting-threads");
const settingConcurrentEl = document.getElementById("setting-concurrent");
const settingMirrorEl = document.getElementById("setting-mirror");
const settingCustomUrlEl = document.getElementById("setting-custom-url");
const settingAutoSyncEl = document.getElementById("setting-auto-sync");
const settingAutoUpdateEl = document.getElementById("setting-auto-update");
const settingCheckUpdateBtn = document.getElementById("setting-check-update-btn");
const settingUpdateStatusEl = document.getElementById("setting-update-status");
const settingCatalogInfoEl = document.getElementById("setting-catalog-info");
const appUpdateBarEl = document.getElementById("app-update-bar");
const appUpdateTextEl = document.getElementById("app-update-text");
const appUpdateDownloadBtn = document.getElementById("app-update-download-btn");
const appUpdateInstallBtn = document.getElementById("app-update-install-btn");
const appUpdateDismissBtn = document.getElementById("app-update-dismiss-btn");
const settingAutoOllamaEl = document.getElementById("setting-auto-ollama");
const settingPaiRootEl = document.getElementById("setting-pai-root");
const settingPaiApiEl = document.getElementById("setting-pai-api");
const settingPaiLevelEl = document.getElementById("setting-pai-level");
const settingAutoPaiEl = document.getElementById("setting-auto-pai");
const settingComfyUiPollEl = document.getElementById("setting-comfyui-poll");
const settingPaiDoctorBtn = document.getElementById("setting-pai-doctor-btn");
const settingPaiStatusEl = document.getElementById("setting-pai-status");
const settingAgentChannelEl = document.getElementById("setting-agent-channel");
const settingAgentLocalBlock = document.getElementById("setting-agent-local-block");
const settingAgentApiBlock = document.getElementById("setting-agent-api-block");
const settingAgentLocalModelEl = document.getElementById("setting-agent-local-model");
const settingAgentApiPresetEl = document.getElementById("setting-agent-api-preset");
const settingAgentApiBaseEl = document.getElementById("setting-agent-api-base");
const settingAgentApiKeyEl = document.getElementById("setting-agent-api-key");
const settingAgentApiModelEl = document.getElementById("setting-agent-api-model");
const settingAgentTestBtn = document.getElementById("setting-agent-test-btn");
const settingAgentTestStatusEl = document.getElementById("setting-agent-test-status");
const settingThemeEl = document.getElementById("setting-theme");
const settingLocaleEl = document.getElementById("setting-locale");

const AGENT_API_PRESETS = {
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  qwen: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  moonshot: { baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  custom: { baseUrl: "", model: "" },
};

function syncAgentBrainBlocks() {
  const channel = settingAgentChannelEl?.value || "builtin";
  settingAgentLocalBlock?.classList.toggle("hidden", channel !== "local");
  settingAgentApiBlock?.classList.toggle("hidden", channel !== "api");
}

async function fillAgentLocalModels(selected) {
  if (!settingAgentLocalModelEl) return;
  let names = [];
  try {
    const list = await window.modelManager.listOllamaModels();
    names = (list || [])
      .map((item) => (typeof item === "string" ? item : item.name || item.model || ""))
      .filter(Boolean);
  } catch {
    names = [];
  }
  const current = selected || settingAgentLocalModelEl.value || "";
  settingAgentLocalModelEl.innerHTML =
    `<option value="">${names.length ? "请选择模型…" : "暂无已导入模型"}</option>` +
    names.map((name) => `<option value="${name}">${name}</option>`).join("");
  if (current && names.includes(current)) {
    settingAgentLocalModelEl.value = current;
  }
}
const appVersionTextEl = document.getElementById("app-version-text");
const sidebarVersionEl = document.getElementById("sidebar-version");
const openLogsBtn = document.getElementById("open-logs-btn");
const startExperienceBtn = document.getElementById("start-experience-btn");
const homeGotoChatBtn = document.getElementById("home-goto-chat-btn");
const homeGotoButlerBtn = document.getElementById("home-goto-butler-btn");
const homeGotoStudioBtn = document.getElementById("home-goto-studio-btn");
const homeGotoSetupBtn = document.getElementById("home-goto-setup-btn");
const homeLightOllama = document.getElementById("home-light-ollama");
const homeLightPai = document.getElementById("home-light-pai");
const homeLightComfy = document.getElementById("home-light-comfy");
const homeLightFfmpeg = document.getElementById("home-light-ffmpeg");
const recentDownloadsEl = document.getElementById("recent-downloads");
const recentSessionsEl = document.getElementById("recent-sessions");
const recentImportedEl = document.getElementById("recent-imported");
const homeVersionEl = document.getElementById("home-version");
const homeHelpBtn = document.getElementById("home-help-btn");
const homeImportOllamaBtn = document.getElementById("home-import-ollama-btn");
const homeImportPanel = document.getElementById("home-import-panel");
const homeImportBadgeEl = document.getElementById("home-import-badge");
const homeImportHintEl = document.getElementById("home-import-hint");
const homeImportListEl = document.getElementById("home-import-list");
const homeImportAllBtn = document.getElementById("home-import-all-btn");
const homeGotoModelsBtn = document.getElementById("home-goto-models-btn");

/** @type {Map<string, object>} */
const downloadState = new Map();
/** @type {Map<string, object>} */
const importState = new Map();
let cachedModels = [];
let metaLoaded = false;

const currentQuery = {
  search: "",
  filter: "all",
  category: "all",
  tag: "all",
  sort: "updatedAt",
  order: "desc",
};

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function setStatus(text) {
  statusTextEl.textContent = text;
}

function getQueryFromControls() {
  return {
    search: searchInputEl.value.trim(),
    filter: filterSelectEl.value,
    category: categorySelectEl.value,
    tag: tagSelectEl.value,
    sort: sortSelectEl.value,
    order: "desc",
  };
}

function renderProgressBlock(progress) {
  if (!progress) return "";
  return `
    <div class="progress-wrap">
      <div class="progress-bar">
        <div class="progress-bar__fill" style="width: ${progress.percent || 0}%"></div>
      </div>
      <div class="progress-meta">
        <span>${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}</span>
        <span>${progress.speedText || "0 B/s"} · 剩余 ${progress.etaText || "--"}</span>
        <span>${(progress.percent || 0).toFixed(1)}%</span>
      </div>
    </div>
  `;
}

function renderModelCard(model) {
  const progress = downloadState.get(model.id) || model.downloadProgress;
  const importing = importState.get(model.id);
  const status = progress?.status || model.queueStatus;
  const isDownloading = ["downloading", "starting", "verifying", "retrying"].includes(status);
  const isPaused = status === "paused";
  const downloaded = model.downloaded || status === "completed";

  let actionHtml = "";
  if (isDownloading) {
    actionHtml = `
      <span class="status-pill status-pill--downloading">${status === "retrying" ? `重试 ${progress?.retryCount || 0}/3` : "下载中"}</span>
      <button class="btn btn--primary" data-action="goto-downloads" type="button">查看进度</button>
      <button class="btn btn--primary" data-action="pause" data-id="${model.id}">暂停</button>
      <button class="btn btn--danger" data-action="cancel" data-id="${model.id}">取消</button>
    `;
  } else if (isPaused || status === "failed") {
    actionHtml = `
      <span class="status-pill status-pill--importing">${isPaused ? "已暂停" : "下载失败"}</span>
      <button class="btn btn--primary" data-action="resume" data-id="${model.id}">继续</button>
      <button class="btn btn--danger" data-action="cancel" data-id="${model.id}">取消</button>
    `;
  } else if (importing && importing.stage !== "completed" && importing.stage !== "skipped") {
    actionHtml = `<span class="status-pill status-pill--importing">${importing.message || "正在自动导入..."}</span>`;
  } else if (model.ollamaImported) {
    actionHtml = `
      <span class="status-pill status-pill--ollama">可以使用</span>
      <button class="btn btn--primary" data-action="chat" data-id="${model.id}">开始聊天</button>
      <button class="btn btn--primary" data-action="remove-ollama" data-id="${model.id}">移除模型</button>
    `;
  } else if (downloaded) {
    actionHtml = `
      <span class="status-pill status-pill--ready">已下载 ${formatBytes(model.localSizeBytes)}</span>
      <button class="btn btn--primary" data-action="import-ollama" data-id="${model.id}">一键导入</button>
    `;
  } else if (model.localOnly) {
    actionHtml = `<span class="status-pill status-pill--ready">本地扫描</span>`;
  } else {
    actionHtml = `<button class="btn btn--primary" data-action="download" data-id="${model.id}">下载</button>`;
  }

  const favoriteClass = model.favorite ? "favorite-btn is-active" : "favorite-btn";
  const tagsHtml = (model.tags || []).map((tag) => `<span class="tag">${tag}</span>`).join("");

  return `
    <article class="model-card" data-model-id="${model.id}">
      <div class="model-card__top">
        <div>
          <div class="model-card__title">${model.name}</div>
          <div class="model-card__ollama-name">${model.category || "通用"} · ${model.autoImport ? "下载后自动导入" : "需手动导入"}</div>
        </div>
        <div class="model-card__side">
          <button class="${favoriteClass}" data-action="favorite" data-id="${model.id}" title="收藏">★</button>
          <div class="model-card__size">${model.size}</div>
        </div>
      </div>
      <p class="model-card__desc">${model.description || "暂无描述"}</p>
      <div class="model-card__meta"><div class="model-card__tags">${tagsHtml}</div></div>
      <div class="model-card__actions">${actionHtml}</div>
      ${renderProgressBlock(isDownloading || isPaused ? progress : null)}
    </article>
  `;
}

function renderModelList(listEl, countEl, models, emptyText) {
  if (!listEl || !countEl) {
    return;
  }

  if (!models.length) {
    listEl.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    countEl.textContent = "0 个模型";
    return;
  }

  listEl.innerHTML = models.map(renderModelCard).join("");
  countEl.textContent = `${models.length} 个模型`;
}

function renderModels(models) {
  cachedModels = models;
  renderModelList(modelListEl, modelCountEl, models, "没有匹配的模型，试试调整搜索或筛选条件");
  window.ChatUI.renderReadyModels(models);
  renderHomeImportPanel();
}

function refreshModelViews() {
  if (window.AppRouter.getCurrentPage() === "models") {
    renderModelList(modelListEl, modelCountEl, cachedModels, "没有匹配的模型，试试调整搜索或筛选条件");
  }
}

function renderQueue(queue) {
  if (!queue.length) {
    queueListEl.innerHTML = `<div class="empty-state queue-empty">当前没有正在下载的任务。去「模型仓库」选择模型并点击下载吧。</div>`;
    queueCountEl.textContent = "空闲";
    return;
  }

  queueListEl.innerHTML = queue
    .map(
      (item) => `
      <div class="queue-item">
        <div>
          <strong>${item.filename}</strong>
          <span class="queue-item__status">${item.status}</span>
        </div>
        <div class="queue-item__meta">
          <span>${formatBytes(item.downloadedBytes)} / ${formatBytes(item.totalBytes)}</span>
          <span>${item.speedText || "0 B/s"}</span>
          <span>剩余 ${item.etaText || "--"}</span>
          <span>${(item.percent || 0).toFixed(1)}%</span>
        </div>
      </div>
    `
    )
    .join("");
  queueCountEl.textContent = `${queue.length} 个任务进行中`;
}

async function loadMeta() {
  if (metaLoaded) return;
  const meta = await window.modelManager.getModelsMeta();
  categorySelectEl.innerHTML = `<option value="all">模型类型</option>${meta.categories
    .map((item) => `<option value="${item.key}">${item.label}</option>`)
    .join("")}`;
  sortSelectEl.innerHTML = meta.sortOptions
    .map((item) => `<option value="${item.key}">${item.label}</option>`)
    .join("");
  tagSelectEl.innerHTML = `<option value="all">模型标签</option>${meta.tags
    .map((tag) => `<option value="${tag}">${tag}</option>`)
    .join("")}`;
  settingMirrorEl.innerHTML = meta.mirrors
    .map((item) => `<option value="${item.key}">${item.label}</option>`)
    .join("");
  metaLoaded = true;
}

async function loadSettingsForm() {
  const settings = await window.modelManager.getSettings();
  settingThreadsEl.value = String(settings.downloadThreads);
  settingConcurrentEl.value = String(settings.maxConcurrentDownloads);
  settingMirrorEl.value = settings.mirror;
  settingCustomUrlEl.value = settings.customMirrorUrl || "";
  settingAutoSyncEl.checked = Boolean(settings.autoSyncOnStartup);
  if (settingAutoUpdateEl) {
    settingAutoUpdateEl.checked = settings.autoCheckUpdates !== false;
  }
  settingAutoOllamaEl.checked = Boolean(settings.autoStartOllama);
  settingPaiRootEl.value = settings.paiRoot || "E:\\projects\\PAI";
  settingPaiApiEl.value = settings.paiApiUrl || "http://127.0.0.1:8765";
  settingPaiLevelEl.value = String(settings.paiDefaultLevel ?? 2);
  settingAutoPaiEl.checked = settings.autoStartPai !== false;
  if (settingComfyUiPollEl) {
    settingComfyUiPollEl.value = String(settings.comfyUiPollIntervalMs ?? 2500);
  }
  settingThemeEl.value = settings.theme || "dark";
  settingLocaleEl.value = settings.locale || "zh";
  if (settingAgentChannelEl) {
    settingAgentChannelEl.value = settings.agentBrainChannel || "builtin";
  }
  if (settingAgentApiPresetEl) {
    settingAgentApiPresetEl.value = settings.agentApiPreset || "deepseek";
  }
  if (settingAgentApiBaseEl) {
    settingAgentApiBaseEl.value = settings.agentApiBaseUrl || "";
  }
  if (settingAgentApiKeyEl) {
    settingAgentApiKeyEl.value = settings.agentApiKey || "";
  }
  if (settingAgentApiModelEl) {
    settingAgentApiModelEl.value = settings.agentApiModel || "";
  }
  await fillAgentLocalModels(settings.agentLocalModel || "");
  syncAgentBrainBlocks();
  window.AppI18n.setTheme(settings.theme || "dark");
  window.AppI18n.setLocale(settings.locale || "zh");

  try {
    const appInfo = await window.modelManager.getAppVersion();
    const versionText = `v${appInfo.version}`;
    appVersionTextEl.textContent = `${window.AppI18n.t("version")} ${appInfo.version}`;
    sidebarVersionEl.textContent = versionText;
  } catch {
    appVersionTextEl.textContent = "";
    sidebarVersionEl.textContent = "";
  }

  try {
    const catalog = await window.modelManager.getCatalogInfo();
    if (settingCatalogInfoEl) {
      settingCatalogInfoEl.textContent = `模型库：${catalog.modelCount} 个模型 · catalog v${catalog.catalogVersion || 0}${
        catalog.lastSyncedAt ? ` · 上次同步 ${new Date(catalog.lastSyncedAt).toLocaleString()}` : ""
      }`;
    }
  } catch {
    if (settingCatalogInfoEl) {
      settingCatalogInfoEl.textContent = "";
    }
  }
}

async function loadModels() {
  try {
    Object.assign(currentQuery, getQueryFromControls());
    const models = await window.modelManager.listModels(currentQuery);
    renderModels(models);
  } catch (error) {
    modelListEl.innerHTML = `<div class="error-state">加载失败：${error.message}</div>`;
  }
}

async function loadQueue() {
  try {
    const queue = await window.modelManager.getDownloadQueue();
    renderQueue(queue);
  } catch {
    renderQueue([]);
  }
}

async function loadOllamaStatus() {
  try {
    const status = await window.modelManager.getOllamaStatus();
    ollamaStatusEl.classList.remove(
      "ollama-status--online",
      "ollama-status--offline",
      "ollama-status--stopped",
      "ollama-status--unknown"
    );

    ollamaStartBtn.classList.toggle("hidden", status.state !== "installed_stopped");
    ollamaInstallBtn.classList.toggle("hidden", status.state !== "not_installed");

    if (status.running) {
      ollamaStatusEl.classList.add("ollama-status--online");
      ollamaStatusTextEl.textContent = `本地 AI 引擎已就绪 · 已加载 ${status.modelCount} 个模型`;
      return;
    }

    if (status.state === "installed_stopped") {
      ollamaStatusEl.classList.add("ollama-status--stopped");
      ollamaStatusTextEl.textContent = "Ollama 已安装但未运行 · 可点击「启动 Ollama」";
      return;
    }

    if (status.state === "not_installed") {
      ollamaStatusEl.classList.add("ollama-status--offline");
      ollamaStatusTextEl.textContent = "未检测到 Ollama · 请先下载安装";
      return;
    }

    ollamaStatusEl.classList.add("ollama-status--offline");
    ollamaStatusTextEl.textContent = status.error || "请先安装并启动 Ollama，才能导入模型和聊天";
  } catch (error) {
    ollamaStatusEl.classList.remove("ollama-status--online", "ollama-status--stopped", "ollama-status--unknown");
    ollamaStatusEl.classList.add("ollama-status--offline");
    ollamaStartBtn.classList.add("hidden");
    ollamaInstallBtn.classList.add("hidden");
    ollamaStatusTextEl.textContent = `无法连接本地 AI 引擎：${error.message}`;
  }
}

function renderDashboardList(el, items, emptyText, formatter) {
  if (!items.length) {
    el.innerHTML = `<li class="dashboard-list__empty">${emptyText}</li>`;
    return;
  }
  el.innerHTML = items.map(formatter).join("");
}

function getPendingImportModels() {
  return (cachedModels || []).filter((model) => {
    if (!model.downloaded || model.ollamaImported) {
      return false;
    }
    const importing = importState.get(model.id);
    if (importing && !["completed", "skipped", "failed"].includes(importing.stage)) {
      return false;
    }
    return true;
  });
}

function renderHomeImportPanel() {
  if (!homeImportPanel) {
    return;
  }

  const pending = getPendingImportModels();
  homeImportBadgeEl.textContent = `${pending.length} 个待导入`;
  homeImportAllBtn.disabled = pending.length === 0;

  const importLabel = pending.length > 0 ? `一键导入 Ollama (${pending.length})` : "一键导入 Ollama";
  homeImportOllamaBtn.textContent = importLabel;

  if (pending.length === 0) {
    homeImportHintEl.textContent =
      "暂无待导入模型。下载完成后会自动导入；也可在「模型仓库」对已下载模型点击「一键导入」。";
    homeImportListEl.innerHTML = `<li class="home-import-list__empty">所有已下载模型均已导入 Ollama。</li>`;
    return;
  }

  homeImportHintEl.textContent = "以下模型已下载，点击「一键导入」即可加入 Ollama：";
  homeImportListEl.innerHTML = pending
    .map(
      (model) => `
      <li class="home-import-list__item">
        <span class="home-import-list__name">${model.name}</span>
        <button class="btn btn--primary btn--tiny" type="button" data-action="home-import-one" data-id="${model.id}">一键导入</button>
      </li>
    `
    )
    .join("");
}

async function runHomeImportFlow() {
  const pending = getPendingImportModels();
  if (!pending.length) {
    window.AppRouter.navigate("models", { modelsMode: "local" });
    filterSelectEl.value = "installed";
    await loadModels();
    setStatus("请在模型仓库查看已下载模型；下载完成后也会自动导入");
    return;
  }

  const status = await window.modelManager.getOllamaStatus();
  if (!status.running) {
    setStatus("请先启动 Ollama，再执行导入");
    await loadOllamaStatus();
    return;
  }

  await importPendingModels(pending);
}

async function importPendingModels(models) {
  for (const model of models) {
    setStatus(`正在导入 ${model.name}...`);
    await handleImportOllama(model.id);
  }
  await refreshAll();
  setStatus("导入任务已完成，可在「我的模型」或「AI 聊天」中使用");
}

function setHomeEnvChip(el, label, ok) {
  if (!el) return;
  el.textContent = `${label} ${ok ? "✓" : "✗"}`;
  el.classList.toggle("home-env-chip--ok", Boolean(ok));
  el.classList.toggle("home-env-chip--bad", !ok);
}

async function loadHomeEnvLights() {
  try {
    const status = await window.modelManager.getSetupStatus();
    const ollamaOk = Boolean(status.ready?.ollama);
    const paiOk = Boolean(status.ready?.pai);
    const comfyOk = Boolean(status.ready?.comfyui);
    const ffmpegOk = Boolean(status.ready?.ffmpeg);
    const allOk = Boolean(status.allReady) || (ollamaOk && paiOk && comfyOk);
    setHomeEnvChip(homeLightOllama, "Ollama", ollamaOk);
    setHomeEnvChip(homeLightPai, "PAI", paiOk);
    setHomeEnvChip(homeLightComfy, "ComfyUI", comfyOk);
    setHomeEnvChip(homeLightFfmpeg, "FFmpeg", ffmpegOk);
    // 「环境」入口：核心三件套齐全即可绿；FFmpeg 单独一灯
    setHomeEnvChip(homeGotoSetupBtn, "环境", allOk);
  } catch {
    setHomeEnvChip(homeLightOllama, "Ollama", false);
    setHomeEnvChip(homeLightPai, "PAI", false);
    setHomeEnvChip(homeLightComfy, "ComfyUI", false);
    setHomeEnvChip(homeLightFfmpeg, "FFmpeg", false);
    setHomeEnvChip(homeGotoSetupBtn, "环境", false);
  }
}

async function loadDashboard() {
  try {
    const stats = await window.modelManager.getDashboardStats();
    renderDashboardList(recentDownloadsEl, stats.recentDownloads, "还没有下载记录", (item) => `<li>${item.name}</li>`);
    renderDashboardList(recentSessionsEl, stats.recentSessions, "还没有聊天记录", (item) => `<li>${item.title}</li>`);
    renderDashboardList(recentImportedEl, stats.recentImported, "还没有导入记录", (item) => `<li>${item.name}</li>`);
    const versionText = `v${stats.version}`;
    sidebarVersionEl.textContent = versionText;
    if (homeVersionEl) {
      homeVersionEl.textContent = versionText;
    }
  } catch {
    renderDashboardList(recentDownloadsEl, [], "加载失败", () => "");
    renderDashboardList(recentSessionsEl, [], "加载失败", () => "");
    renderDashboardList(recentImportedEl, [], "加载失败", () => "");
  }

  renderHomeImportPanel();
  await loadHomeEnvLights();
}

async function syncModelCache() {
  const models = await window.modelManager.listModels({});
  cachedModels = models;
  window.ChatUI.renderReadyModels(models);
  return models;
}

function setCachedModels(models) {
  cachedModels = models;
}

function getDownloadState(modelId) {
  return downloadState.get(modelId);
}

function getImportState(modelId) {
  return importState.get(modelId);
}

function setImportState(modelId, state) {
  importState.set(modelId, state);
}

function clearImportState(modelId) {
  importState.delete(modelId);
}

async function refreshAll() {
  await loadModels();
  await loadQueue();
  await loadOllamaStatus();
  await loadDashboard();
  if (window.AppRouter.getCurrentPage() === "my-models") {
    await window.MyModelsPage.load();
  }
  setStatus("就绪");
}

async function handleDownload(modelId) {
  try {
    const current = await window.modelManager.getStoragePath();
    const picked = await window.modelManager.pickStoragePath(current);
    if (!picked) {
      setStatus("已取消选择保存位置");
      return;
    }
    const resolved = await window.modelManager.setStoragePath(picked);
    if (storagePathEl) {
      storagePathEl.value = resolved || picked;
    }
    await window.modelManager.startDownload(modelId);
    await refreshAll();
    setStatus(`已加入下载队列 → ${resolved || picked}`);
    window.AppRouter.navigate("downloads");
  } catch (error) {
    setStatus(`下载启动失败：${error.message}`);
  }
}

async function handlePause(modelId) {
  await window.modelManager.pauseDownload(modelId);
  await refreshAll();
  setStatus("下载已暂停，支持断点续传");
}

async function handleResume(modelId) {
  await window.modelManager.resumeDownload(modelId);
  await refreshAll();
  setStatus("下载已恢复");
}

async function handleCancel(modelId) {
  await window.modelManager.cancelDownload(modelId);
  downloadState.delete(modelId);
  await refreshAll();
  setStatus("下载已取消");
}

async function handleImportOllama(modelId) {
  try {
    importState.set(modelId, { stage: "starting", message: "正在准备导入..." });
    refreshModelViews();
    await window.modelManager.importToOllama(modelId);
  } catch (error) {
    importState.delete(modelId);
    setStatus(`导入失败：${error.message}`);
  }
}

async function handleRemoveOllama(modelId) {
  try {
    await window.modelManager.removeFromOllama(modelId);
    await refreshAll();
    setStatus("已移除模型");
  } catch (error) {
    setStatus(`移除失败：${error.message}`);
  }
}

async function handleFavorite(modelId) {
  await window.modelManager.toggleFavorite(modelId);
  await loadModels();
}

function openChatWithModel(modelId) {
  openChatWithModelAsync(modelId);
}

async function openChatWithModelAsync(modelId) {
  try {
    const models = await syncModelCache();
    const model = models.find((item) => item.id === modelId);
    if (!model) {
      setStatus("未找到该模型");
      return;
    }
    if (!model.ollamaImported) {
      setStatus("模型尚未就绪，请等待 Ollama 导入完成");
      refreshModelViews();
      return;
    }
    const opened = window.ChatUI.enterWithModel(model);
    if (opened) {
      setStatus(`已进入 ${model.name} 的对话`);
    }
  } catch (error) {
    setStatus(`打开聊天失败：${error.message}`);
  }
}

function handleModelListClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const modelId = button.dataset.id;
  const action = button.dataset.action;

  if (action === "goto-downloads") window.AppRouter.navigate("downloads");
  else if (action === "download") handleDownload(modelId);
  else if (action === "pause") handlePause(modelId);
  else if (action === "resume") handleResume(modelId);
  else if (action === "cancel") handleCancel(modelId);
  else if (action === "import-ollama") handleImportOllama(modelId);
  else if (action === "remove-ollama") handleRemoveOllama(modelId);
  else if (action === "favorite") handleFavorite(modelId);
  else if (action === "chat") openChatWithModel(modelId);
}

modelListEl.addEventListener("click", handleModelListClick);

[searchInputEl, filterSelectEl, categorySelectEl, tagSelectEl, sortSelectEl].forEach((el) => {
  el.addEventListener("change", () => loadModels());
});
searchInputEl.addEventListener("input", () => {
  clearTimeout(window.__searchTimer);
  window.__searchTimer = setTimeout(() => loadModels(), 250);
});

refreshBtn?.addEventListener("click", () => {
  loadStoragePath();
  refreshAll();
});

changeStorageBtn?.addEventListener("click", () => {
  openStoragePathModal().catch((error) => {
    setStatus(`打开设置窗口失败：${error.message}`);
  });
});

storagePathCancelBtn?.addEventListener("click", closeStoragePathModal);
storagePathModalEl?.addEventListener("click", (event) => {
  if (event.target.dataset.action === "close-storage-modal") {
    closeStoragePathModal();
  }
});

storageDriveListEl?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-drive]");
  if (!button) {
    return;
  }
  storagePathInputEl.value = button.dataset.drive;
  renderStorageDriveButtons();
});

storagePathInputEl?.addEventListener("input", () => {
  renderStorageDriveButtons();
});

storagePathBrowseBtn?.addEventListener("click", async () => {
  try {
    const picked = await window.modelManager.pickStoragePath(storagePathInputEl.value.trim());
    if (picked) {
      storagePathInputEl.value = picked;
      await renderStorageDriveButtons();
    }
  } catch (error) {
    setStatus(`浏览文件夹失败：${error.message}`);
  }
});

storagePathConfirmBtn?.addEventListener("click", async () => {
  try {
    await applyStoragePath(storagePathInputEl.value);
  } catch (error) {
    setStatus(`更改保存位置失败：${error.message}`);
  }
});

storagePathInputEl?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    storagePathConfirmBtn.click();
  }
  if (event.key === "Escape") {
    closeStoragePathModal();
  }
});

ollamaStartBtn.addEventListener("click", async () => {
  ollamaStartBtn.disabled = true;
  ollamaStatusTextEl.textContent = "正在启动 Ollama...";
  try {
    await window.modelManager.startOllama();
    await refreshAll();
    setStatus("Ollama 已启动");
  } catch (error) {
    setStatus(`启动 Ollama 失败：${error.message}`);
    await loadOllamaStatus();
  } finally {
    ollamaStartBtn.disabled = false;
  }
});

ollamaInstallBtn.addEventListener("click", async () => {
  try {
    await window.modelManager.openOllamaInstallPage();
    setStatus("已在浏览器打开 Ollama 下载页");
  } catch (error) {
    setStatus(`打开下载页失败：${error.message}`);
  }
});

settingsFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  await window.modelManager.updateSettings({
    downloadThreads: Number(settingThreadsEl.value),
    maxConcurrentDownloads: Number(settingConcurrentEl.value),
    mirror: settingMirrorEl.value,
    customMirrorUrl: settingCustomUrlEl.value.trim(),
    autoSyncOnStartup: settingAutoSyncEl.checked,
    autoCheckUpdates: settingAutoUpdateEl?.checked !== false,
    autoStartOllama: settingAutoOllamaEl.checked,
    paiRoot: settingPaiRootEl.value.trim(),
    paiApiUrl: settingPaiApiEl.value.trim(),
    paiDefaultLevel: Number(settingPaiLevelEl.value),
    autoStartPai: settingAutoPaiEl.checked,
    comfyUiPollIntervalMs: Number(settingComfyUiPollEl?.value || 2500),
    theme: settingThemeEl.value,
    locale: settingLocaleEl.value,
    agentBrainChannel: settingAgentChannelEl?.value || "builtin",
    agentLocalModel: settingAgentLocalModelEl?.value || "",
    agentApiPreset: settingAgentApiPresetEl?.value || "custom",
    agentApiBaseUrl: settingAgentApiBaseEl?.value?.trim() || "",
    agentApiKey: settingAgentApiKeyEl?.value?.trim() || "",
    agentApiModel: settingAgentApiModelEl?.value?.trim() || "",
  });
  await loadSettingsForm();
  setStatus("设置已保存");
});

settingAgentChannelEl?.addEventListener("change", syncAgentBrainBlocks);

settingAgentApiPresetEl?.addEventListener("change", () => {
  const preset = AGENT_API_PRESETS[settingAgentApiPresetEl.value];
  if (!preset || settingAgentApiPresetEl.value === "custom") return;
  if (settingAgentApiBaseEl) settingAgentApiBaseEl.value = preset.baseUrl;
  if (settingAgentApiModelEl) settingAgentApiModelEl.value = preset.model;
});

settingAgentTestBtn?.addEventListener("click", async () => {
  // 先把当前表单写入，再测
  settingAgentTestBtn.disabled = true;
  if (settingAgentTestStatusEl) settingAgentTestStatusEl.textContent = "测试中…";
  try {
    await window.modelManager.updateSettings({
      agentBrainChannel: settingAgentChannelEl?.value || "builtin",
      agentLocalModel: settingAgentLocalModelEl?.value || "",
      agentApiPreset: settingAgentApiPresetEl?.value || "custom",
      agentApiBaseUrl: settingAgentApiBaseEl?.value?.trim() || "",
      agentApiKey: settingAgentApiKeyEl?.value?.trim() || "",
      agentApiModel: settingAgentApiModelEl?.value?.trim() || "",
    });
    const result = await window.modelManager.testAgentBrain();
    if (settingAgentTestStatusEl) {
      settingAgentTestStatusEl.textContent = result.message || "OK";
    }
    setStatus(result.message || "Agent 脑子测试完成");
  } catch (error) {
    if (settingAgentTestStatusEl) settingAgentTestStatusEl.textContent = error.message;
    setStatus(`测试失败：${error.message}`);
  } finally {
    settingAgentTestBtn.disabled = false;
  }
});

openLogsBtn.addEventListener("click", async () => {
  try {
    await window.modelManager.openLogs();
  } catch (error) {
    setStatus(`打开日志失败：${error.message}`);
  }
});

settingPaiDoctorBtn.addEventListener("click", async () => {
  settingPaiDoctorBtn.disabled = true;
  settingPaiStatusEl.textContent = "检测中…";
  try {
    await window.modelManager.ensurePai();
    const data = await window.modelManager.runPaiDoctor();
    const rows = data?.results || [];
    const failed = rows.filter((r) => r.status !== "ok").length;
    settingPaiStatusEl.textContent =
      failed === 0 ? `PAI 正常（${rows.length} 项）` : `PAI 有 ${failed} 项异常`;
    setStatus("PAI 检测完成");
  } catch (error) {
    settingPaiStatusEl.textContent = error.message;
    setStatus(`PAI 检测失败：${error.message}`);
  } finally {
    settingPaiDoctorBtn.disabled = false;
  }
});

syncBtn.addEventListener("click", async () => {
  try {
    setStatus("正在更新模型库...");
    const result = await window.modelManager.syncModels();
    if (result.synced) {
      const source =
        result.source === "bundled-catalog" ? "内置 catalog" : result.source?.includes("http") ? "CDN" : result.source;
      setStatus(
        `模型库已更新（${source}）：新增 ${result.added}，更新 ${result.updated}，共 ${result.total} 个 · v${result.catalogVersion || "?"}`
      );
    } else {
      setStatus(result.reason || "暂未配置在线模型库地址");
    }
    await loadModels();
    await loadSettingsForm();
  } catch (error) {
    setStatus(`更新失败：${error.message}`);
  }
});

let pendingUpdateVersion = null;

function showUpdateBar(message, { showDownload = true, showInstall = false } = {}) {
  if (!appUpdateBarEl) {
    return;
  }
  appUpdateTextEl.textContent = message;
  appUpdateBarEl.classList.remove("hidden");
  appUpdateDownloadBtn.classList.toggle("hidden", !showDownload);
  appUpdateInstallBtn.classList.toggle("hidden", !showInstall);
}

function hideUpdateBar() {
  appUpdateBarEl?.classList.add("hidden");
}

window.modelManager.onAppUpdateAvailable((payload) => {
  pendingUpdateVersion = payload.version;
  showUpdateBar(`发现新版本 v${payload.version}，是否下载？`);
  if (settingUpdateStatusEl) {
    settingUpdateStatusEl.textContent = `可更新至 v${payload.version}`;
  }
});

window.modelManager.onAppUpdateProgress((payload) => {
  showUpdateBar(`正在下载更新… ${Math.round(payload.percent || 0)}%`, { showDownload: false, showInstall: false });
});

window.modelManager.onAppUpdateDownloaded((payload) => {
  pendingUpdateVersion = payload.version;
  showUpdateBar(`v${payload.version} 已下载，重启后安装`, { showDownload: false, showInstall: true });
  if (settingUpdateStatusEl) {
    settingUpdateStatusEl.textContent = "更新已就绪，可重启安装";
  }
});

window.modelManager.onAppUpdateError((payload) => {
  if (settingUpdateStatusEl) {
    settingUpdateStatusEl.textContent = payload.message || "检查失败";
  }
});

appUpdateDownloadBtn?.addEventListener("click", async () => {
  try {
    appUpdateDownloadBtn.disabled = true;
    await window.modelManager.downloadAppUpdate();
  } catch (error) {
    setStatus(`下载更新失败：${error.message}`);
  } finally {
    appUpdateDownloadBtn.disabled = false;
  }
});

appUpdateInstallBtn?.addEventListener("click", async () => {
  await window.modelManager.installAppUpdate();
});

appUpdateDismissBtn?.addEventListener("click", () => {
  hideUpdateBar();
});

settingCheckUpdateBtn?.addEventListener("click", async () => {
  settingCheckUpdateBtn.disabled = true;
  if (settingUpdateStatusEl) {
    settingUpdateStatusEl.textContent = "检查中…";
  }
  try {
    const result = await window.modelManager.checkAppUpdate();
    if (result.skipped) {
      settingUpdateStatusEl.textContent = result.reason || "已跳过";
    } else if (!pendingUpdateVersion) {
      settingUpdateStatusEl.textContent = "当前已是最新版本";
    }
  } catch (error) {
    settingUpdateStatusEl.textContent = error.message;
  } finally {
    settingCheckUpdateBtn.disabled = false;
  }
});

startExperienceBtn?.addEventListener("click", () => {
  window.AppRouter.navigate("models", { modelsMode: "local" });
  setStatus("请选择一个模型，点击「下载」开始使用");
});

homeGotoChatBtn?.addEventListener("click", () => {
  window.AppRouter.navigate("chat");
});

homeGotoStudioBtn?.addEventListener("click", () => {
  window.AppRouter.navigate("studio");
});

homeGotoSetupBtn?.addEventListener("click", () => {
  window.AppRouter.navigate("setup");
});

homeGotoButlerBtn?.addEventListener("click", () => {
  window.AppRouter.navigate("agent-intro");
});

document.getElementById("agent-intro-goto-agent-btn")?.addEventListener("click", () => {
  window.AppRouter.navigate("chat");
});

document.getElementById("agent-intro-goto-setup-btn")?.addEventListener("click", () => {
  window.AppRouter.navigate("setup");
});

homeImportOllamaBtn.addEventListener("click", () => {
  runHomeImportFlow();
});

homeImportAllBtn.addEventListener("click", () => {
  importPendingModels(getPendingImportModels());
});

homeGotoModelsBtn.addEventListener("click", () => {
  window.AppRouter.navigate("models", { modelsMode: "gate" });
});

homeImportListEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action='home-import-one']");
  if (!button) {
    return;
  }
  const modelId = button.dataset.id;
  const status = await window.modelManager.getOllamaStatus();
  if (!status.running) {
    setStatus("请先启动 Ollama，再执行导入");
    await loadOllamaStatus();
    return;
  }
  await handleImportOllama(modelId);
  await refreshAll();
});

homeHelpBtn?.addEventListener("click", () => {
  window.AppRouter.navigate("help");
});

window.modelManager.onDownloadProgress((payload) => {
  downloadState.set(payload.modelId, payload);
  if (window.AppRouter.getCurrentPage() === "models") {
    refreshModelViews();
  }
  loadQueue();
  setStatus(`正在下载 ${payload.filename}：${payload.speedText || "0 B/s"}`);
});

window.modelManager.onDownloadComplete(async () => {
  downloadState.clear();
  await refreshAll();
});

window.modelManager.onDownloadError(async (payload) => {
  downloadState.delete(payload.modelId);
  await refreshAll();
  setStatus(`下载失败：${payload.message}`);
});

window.modelManager.onOllamaImportProgress((payload) => {
  importState.set(payload.modelId, payload);
  if (window.AppRouter.getCurrentPage() === "models") {
    refreshModelViews();
  }
  renderHomeImportPanel();
  setStatus(payload.message || "正在自动导入...");
});

window.modelManager.onOllamaImportComplete(async (payload) => {
  importState.delete(payload.modelId);
  window.MyModelsPage.clearImportError(payload.modelId);
  await refreshAll();
  await syncModelCache();
  refreshModelViews();
  renderHomeImportPanel();

  const onDownloads = window.AppRouter.getCurrentPage() === "downloads";
  if (onDownloads) {
    window.AppRouter.navigate("my-models");
    await window.MyModelsPage.load();
  }

  setStatus(
    payload.skipped
      ? "模型已可用，点击「开始聊天」即可对话"
      : "导入完成，点击「开始聊天」即可开始对话"
  );
});

window.modelManager.onOllamaImportError(async (payload) => {
  importState.delete(payload.modelId);
  await refreshAll();
  setStatus(`导入失败：${payload.message}`);
});

window.modelManager.onOllamaRemoved(refreshAll);

function closeStoragePathModal() {
  storagePathModalEl.classList.add("hidden");
}

async function renderStorageDriveButtons() {
  storageDriveListEl.innerHTML = "";
  let drives = [];
  try {
    drives = await window.modelManager.listStorageDrives();
  } catch {
    drives = [];
  }

  if (!drives.length) {
    storageDriveListEl.innerHTML =
      '<span class="storage-path-modal__hint">未检测到可用盘符，请直接在下方输入路径。</span>';
    return;
  }

  const current = storagePathInputEl.value.trim().toUpperCase();
  storageDriveListEl.innerHTML = drives
    .map((drive) => {
      const active = current.startsWith(drive.replace(/\\$/, "").toUpperCase()) ? " is-active" : "";
      return `<button type="button" class="storage-drive-btn${active}" data-drive="${drive}">${drive}</button>`;
    })
    .join("");
}

async function openStoragePathModal() {
  storagePathInputEl.value = storagePathEl.value || (await window.modelManager.getStoragePath());
  await renderStorageDriveButtons();
  storagePathModalEl.classList.remove("hidden");
  storagePathInputEl.focus();
  storagePathInputEl.select();
}

async function applyStoragePath(dirPath) {
  const trimmed = dirPath.trim();
  if (!trimmed) {
    throw new Error("请输入有效的文件夹路径");
  }
  const newPath = await window.modelManager.setStoragePath(trimmed);
  storagePathEl.value = newPath;
  await refreshAll();
  setStatus(`模型保存位置已更改：${newPath}`);
  closeStoragePathModal();
}

async function loadStoragePath() {
  if (!storagePathEl) return;
  try {
    storagePathEl.value = await window.modelManager.getStoragePath();
  } catch {
    storagePathEl.value = "";
  }
}

window.AppCore = {
  getCachedModels: () => cachedModels,
  setCachedModels,
  getDownloadState,
  getImportState,
  setImportState,
  clearImportState,
  loadDashboard,
  loadModels,
  loadQueue,
  loadSettingsForm,
  loadOllamaStatus,
  refreshAll,
  syncModelCache,
  openChatWithModel: openChatWithModelAsync,
  setStatus,
};

(async function bootstrap() {
  window.MyModelsPage.init();
  window.ChatUI.init();
  window.ButlerUI.init();
  window.ComfyUiPanel.init();
  window.SetupPanel?.init();
  window.StudioPanel?.init();
  window.ComposePanel?.init();
  window.PageController.init();

  await loadMeta();
  await loadSettingsForm();
  await loadStoragePath();
  await refreshAll();
})();

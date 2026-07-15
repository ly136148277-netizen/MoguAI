const { app, BrowserWindow, ipcMain, shell, Menu, dialog, session, protocol, net } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "mogu-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

const { ModelRepository } = require("./repo");
const { StorageManager } = require("./storage");
const { DownloadEngine } = require("./download-engine");
const { OllamaService, resolveOllamaName, OLLAMA_INSTALL_URL } = require("./ollama");
const { SettingsStore } = require("./settings");
const { listMirrorOptions } = require("./mirrors");
const { ChatSessionStore, exportSessionToMarkdown } = require("./chat-sessions");
const { Logger } = require("./logger");
const { PaiBridge } = require("./pai-bridge");
const {
  getComfyUiStatus,
  fetchQueue,
  collectPromptIds,
  getProgressSnapshot,
  interruptComfyUi,
  openComfyUiInBrowser,
} = require("./comfyui-bridge");
const { scanLocalEnvironment, applyComfyUiToPai } = require("./env-scan");
const {
  getSetupStatus,
  installOllama,
  installPaiRuntime,
  installFfmpeg,
  bindPaiRoot,
  openComfyGuide,
  scanAndApplyComfyUi,
} = require("./setup-hub");
const { StudioStore } = require("./studio-store");
const { initAutoUpdater } = require("./updater");
const { chatWithBrain, testBrain, API_PRESETS } = require("./agent-brain");
const powerControl = require("./power-control");

let mainWindow = null;
let repo = null;
let storage = null;
let downloader = null;
let ollama = null;
let settingsStore = null;
let chatSessions = null;
let logger = null;
let paiBridge = null;
let appUpdater = null;
let studioStore = null;
let allModelsCache = [];
let promptTemplates = [];

function readUserEnv(name) {
  try {
    return require("child_process")
      .execFileSync(
        "powershell",
        ["-NoProfile", "-Command", `[Environment]::GetEnvironmentVariable('${name}','User')`],
        { encoding: "utf8", windowsHide: true, timeout: 5000 }
      )
      .trim();
  } catch {
    return "";
  }
}

/**
 * Follow OS / v2rayN system proxy. No settings toggle needed.
 * Always keep loopback out of proxy (ComfyUI/PAI/Ollama on 127.0.0.1).
 * Call again after changing v2rayN — refresh is enough, full restart not required.
 */
async function applyProxyPolicy() {
  const httpProxy = readUserEnv("HTTP_PROXY");
  const httpsProxy = readUserEnv("HTTPS_PROXY") || httpProxy;
  const userNoProxy = readUserEnv("NO_PROXY");

  if (httpProxy) {
    process.env.HTTP_PROXY = httpProxy;
    process.env.http_proxy = httpProxy;
  } else {
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
  }
  if (httpsProxy) {
    process.env.HTTPS_PROXY = httpsProxy;
    process.env.https_proxy = httpsProxy;
  } else {
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
  }

  const extras = ["127.0.0.1", "localhost", "::1", ".local"];
  const current = String(userNoProxy || process.env.NO_PROXY || "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = [...new Set([...current, ...extras])].join(",");
  process.env.NO_PROXY = merged;
  process.env.no_proxy = merged;

  try {
    await session.defaultSession.setProxy({ mode: "direct" });
    await session.defaultSession.setProxy({ mode: "system" });
    await session.defaultSession.clearAuthCache();
    logger?.info?.("网络代理已刷新：跟随系统，本机地址直连", {
      HTTP_PROXY: process.env.HTTP_PROXY || "",
      NO_PROXY: process.env.NO_PROXY || "",
    });
    return {
      ok: true,
      httpProxy: process.env.HTTP_PROXY || "",
      httpsProxy: process.env.HTTPS_PROXY || "",
      noProxy: process.env.NO_PROXY || "",
      mode: "system",
    };
  } catch (error) {
    logger?.warn?.("设置系统代理模式失败", { message: error.message });
    return { ok: false, error: error.message };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    title: "MOGU AI",
    icon: path.join(__dirname, "../../assets/icon.png"),
    backgroundColor: "#0f1419",
    autoHideMenuBar: true,
    ...(process.platform === "win32"
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: "#0f1419",
            symbolColor: "#e5e7eb",
            height: 28,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  if (!app.isPackaged && process.env.ELECTRON_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function getModelfilesDir() {
  return path.join(storage.storageDir, "modelfiles");
}

function getDownloadStateDir() {
  return path.join(app.getPath("userData"), "downloads");
}

function initServices() {
  const appPath = app.getAppPath();
  const userData = app.getPath("userData");
  repo = new ModelRepository(
    path.join(appPath, "models.json"),
    path.join(appPath, "config", "repository.json"),
    {
      userCatalogPath: path.join(userData, "models-catalog.json"),
      bundledCatalogPath: path.join(appPath, "catalog", "models.json"),
    }
  );
  storage = new StorageManager();
  settingsStore = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  chatSessions = new ChatSessionStore(path.join(app.getPath("userData"), "chat-sessions"));
  studioStore = new StudioStore(path.join(app.getPath("userData"), "studio-pipeline.json"));
  logger = new Logger(path.join(app.getPath("userData"), "logs"));
  paiBridge = new PaiBridge();
  ollama = new OllamaService();
  downloader = new DownloadEngine(storage, settingsStore, {
    stateDir: getDownloadStateDir(),
    onProgress: (progress) => sendToRenderer("download-progress", progress),
    onComplete: (payload) => handleDownloadComplete(payload),
    onError: (payload) => sendToRenderer("download-error", payload),
  });

  const promptsPath = path.join(appPath, "config", "prompts.json");
  if (fs.pathExistsSync(promptsPath)) {
    promptTemplates = fs.readJsonSync(promptsPath);
  }
}

async function refreshAllModels() {
  await repo.loadModels();
  allModelsCache = await repo.getAllModels(storage.storageDir);
  return allModelsCache;
}

function getModelById(modelId) {
  const model = allModelsCache.find((item) => item.id === modelId);
  if (!model) {
    throw new Error(`未找到模型: ${modelId}`);
  }
  return model;
}

async function getOllamaNameSet() {
  try {
    const models = await ollama.listModels();
    const names = new Set();
    for (const item of models) {
      names.add(item.name);
      names.add(item.name.split(":")[0]);
    }
    return names;
  } catch {
    return new Set();
  }
}

async function buildModelList(query = {}) {
  await storage.ensureStorageDir();
  const models = await refreshAllModels();
  const downloaded = await storage.listAllDownloadedModels();
  const downloadedMap = new Map(downloaded.map((item) => [item.filename, item]));
  const settings = await settingsStore.load();
  const favorites = await settingsStore.getFavorites();
  const recentIds = settings.recentDownloads
    .filter((item) => {
      const days = (Date.now() - new Date(item.downloadedAt).getTime()) / (1000 * 60 * 60 * 24);
      return days <= 30;
    })
    .map((item) => item.modelId);
  const ollamaNames = await getOllamaNameSet();
  const queueMap = new Map(downloader.getQueueSnapshot().map((item) => [item.modelId, item]));

  const filtered = repo.queryModels(models, {
    ...query,
    favorites,
    recentIds,
    installedFilenames: new Set(downloaded.map((item) => item.filename)),
  });

  const mapped = filtered.map((model) => {
    const local = downloadedMap.get(model.filename);
    const ollamaName = resolveOllamaName(model);
    const queue = queueMap.get(model.id);
    return {
      ...model,
      downloaded: Boolean(local),
      localPath: local?.path || null,
      localSizeBytes: local?.sizeBytes || 0,
      ollamaName,
      ollamaImported: ollamaNames.has(ollamaName) || ollamaNames.has(`${ollamaName}:latest`),
      autoImport: model.ollama?.autoImport !== false,
      favorite: favorites.has(model.id),
      recent: recentIds.includes(model.id),
      queueStatus: queue?.status || null,
      downloading: queue?.status === "downloading",
      paused: queue?.status === "paused",
      downloadProgress: queue || null,
    };
  });

  return enrichModelLocalFiles(mapped);
}

async function enrichModelLocalFiles(models) {
  const enriched = [];
  for (const model of models) {
    if (model.downloaded && model.localPath) {
      enriched.push(model);
      continue;
    }
    const resolved = await storage.resolveModelFile(model);
    if (resolved) {
      enriched.push({
        ...model,
        downloaded: true,
        localPath: resolved.path,
        localSizeBytes: resolved.sizeBytes,
        fileInLegacyDir:
          resolved.storageDir &&
          path.resolve(resolved.storageDir) !== path.resolve(storage.storageDir),
      });
      continue;
    }
    enriched.push(model);
  }
  return enriched;
}

async function importModelToOllama(model, ggufPath, options = {}) {
  return ollama.importModel(model, ggufPath, getModelfilesDir(), (progress) => {
    sendToRenderer("ollama-import-progress", {
      modelId: model.id,
      ollamaName: resolveOllamaName(model),
      ...progress,
    });
  }, options);
}

function buildOllamaMessages(session) {
  const messages = [];
  if (session.systemPrompt?.trim()) {
    messages.push({ role: "system", content: session.systemPrompt.trim() });
  }
  for (const item of session.messages) {
    if (item.role === "user" || item.role === "assistant") {
      messages.push({ role: item.role, content: item.content });
    }
  }
  return messages;
}

async function runChatGeneration(sessionId, regenerate = false) {
  const session = await chatSessions.get(sessionId);
  const model = getModelById(session.modelId);
  const ollamaName = resolveOllamaName(model);

  if (regenerate) {
    while (session.messages.length && session.messages[session.messages.length - 1].role === "assistant") {
      session.messages.pop();
    }
    await chatSessions.setMessages(sessionId, session.messages);
  }

  const messages = buildOllamaMessages(session);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    throw new Error("没有可生成的用户消息");
  }

  let fullReply = "";
  let tokenStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const result = await ollama.chat(ollamaName, messages, (chunk, payload) => {
    fullReply += chunk;
    if (payload.done) {
      tokenStats = {
        promptTokens: payload.prompt_eval_count || 0,
        completionTokens: payload.eval_count || 0,
        totalTokens: (payload.prompt_eval_count || 0) + (payload.eval_count || 0),
      };
    }
    sendToRenderer("ollama-chat-chunk", {
      sessionId,
      modelId: model.id,
      ollamaName,
      chunk,
      content: fullReply,
    });
  }, { chatId: sessionId });

  fullReply = result.message?.content || fullReply;
  tokenStats = {
    promptTokens: result.promptTokens || tokenStats.promptTokens,
    completionTokens: result.completionTokens || tokenStats.completionTokens,
    totalTokens: result.totalTokens || tokenStats.totalTokens,
  };

  await chatSessions.appendMessage(sessionId, {
    role: "assistant",
    content: fullReply,
    tokens: tokenStats,
    createdAt: new Date().toISOString(),
  });

  return {
    sessionId,
    modelId: model.id,
    ollamaName,
    reply: fullReply,
    tokens: tokenStats,
  };
}

async function handleDownloadComplete(payload) {
  sendToRenderer("download-complete", {
    modelId: payload.modelId,
    filename: payload.filename,
    path: payload.path,
  });

  const model = payload.model;
  if (model.ollama?.autoImport !== false) {
    try {
      sendToRenderer("ollama-import-progress", {
        modelId: model.id,
        ollamaName: resolveOllamaName(model),
        stage: "starting",
        message: "下载完成，开始导入 Ollama...",
      });
      const result = await importModelToOllama(model, payload.path);
      sendToRenderer("ollama-import-complete", {
        modelId: model.id,
        ollamaName: resolveOllamaName(model),
        skipped: Boolean(result.skipped),
      });
    } catch (error) {
      sendToRenderer("ollama-import-error", {
        modelId: model.id,
        ollamaName: resolveOllamaName(model),
        message: error.message || "导入 Ollama 失败",
      });
    }
  }
}

function registerIpcHandlers() {
  ipcMain.handle("models:list", async (_event, query = {}) => buildModelList(query));

  ipcMain.handle("models:meta", async () => {
    const models = await refreshAllModels();
    return {
      categories: repo.listCategories(),
      sortOptions: repo.listSortOptions(),
      tags: repo.listTags(models),
      mirrors: listMirrorOptions(),
    };
  });

  ipcMain.handle("models:sync", async () => repo.syncRemoteCatalog());

  ipcMain.handle("models:toggle-favorite", async (_event, modelId) => {
    await settingsStore.toggleFavorite(modelId);
    return buildModelList();
  });

  ipcMain.handle("settings:get", async () => settingsStore.load());

  ipcMain.handle("settings:update", async (_event, partial) => {
    await settingsStore.update(partial);
    return settingsStore.load();
  });

  ipcMain.handle("agent:brain-presets", async () => API_PRESETS);

  ipcMain.handle("agent:brain-chat", async (_event, payload = {}) => {
    const settings = await settingsStore.load();
    return chatWithBrain({
      settings,
      ollama,
      userText: String(payload.text || "").trim(),
      history: Array.isArray(payload.history) ? payload.history : [],
    });
  });

  ipcMain.handle("agent:brain-test", async () => {
    const settings = await settingsStore.load();
    return testBrain({ settings, ollama });
  });

  ipcMain.handle("storage:get-path", async () => {
    await storage.ensureStorageDir();
    return storage.storageDir;
  });

  ipcMain.handle("storage:list-drives", async () => {
    if (process.platform !== "win32") {
      return [];
    }
    const drives = [];
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      try {
        await fs.access(drive);
        drives.push(drive);
      } catch {
        // 盘符不存在
      }
    }
    return drives;
  });

  ipcMain.handle("storage:pick-path", async (_event, defaultPath) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择模型下载位置",
      message: "请选中要保存模型的文件夹，再点击「选择文件夹」确认",
      buttonLabel: "下载到此文件夹",
      defaultPath: defaultPath || storage.storageDir,
      properties: ["openDirectory", "createDirectory", "promptToCreate"],
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("storage:set-path", async (_event, dirPath) => {
    if (!dirPath || typeof dirPath !== "string") {
      throw new Error("存储路径无效");
    }
    const resolved = await storage.setStorageDir(dirPath);
    await settingsStore.update({ modelStoragePath: resolved });
    await refreshAllModels();
    return resolved;
  });

  ipcMain.handle("storage:open-path", async (_event, dirPath) => {
    const target = dirPath || storage.storageDir;
    await shell.openPath(target);
    return target;
  });

  ipcMain.handle("download:queue", async () => downloader.getQueueSnapshot());

  ipcMain.handle("download:start", async (_event, modelId) => {
    const model = getModelById(modelId);
    if (model.localOnly && !model.url) {
      throw new Error("本地扫描模型无需下载");
    }
    return downloader.enqueue(model);
  });

  ipcMain.handle("download:pause", async (_event, modelId) => downloader.pause(modelId));

  ipcMain.handle("download:resume", async (_event, modelId) => downloader.resume(modelId));

  ipcMain.handle("download:cancel", async (_event, modelId) => ({
    cancelled: downloader.cancelDownload(modelId),
    modelId,
  }));

  ipcMain.handle("ollama:status", async () => ollama.getStatus());

  ipcMain.handle("ollama:start", async () => ollama.startServe());

  ipcMain.handle("ollama:open-install", async () => {
    await shell.openExternal(OLLAMA_INSTALL_URL);
    return OLLAMA_INSTALL_URL;
  });

  ipcMain.handle("ollama:list", async () => ollama.listModels());

  ipcMain.handle("ollama:import", async (_event, payload) => {
    const modelId = typeof payload === "string" ? payload : payload?.modelId;
    const force = typeof payload === "object" && Boolean(payload?.force);
    const model = getModelById(modelId);
    const ollamaName = resolveOllamaName(model);

    try {
      const status = await ollama.getStatus();
      if (!status.running) {
        throw new Error("Ollama 未运行，请先点击顶部「启动 Ollama」");
      }

      const resolved = await storage.resolveModelFile(model);
      if (!resolved?.path) {
        throw new Error(
          "未找到本地 GGUF 文件。模型可能在旧目录中已被移动；请确认「模型保存位置」，或重新下载该模型。"
        );
      }

      if (force) {
        await ollama.removeModel(ollamaName, { ignoreMissing: true });
      }

      const result = await importModelToOllama(model, resolved.path, { force });
      sendToRenderer("ollama-import-complete", {
        modelId,
        ollamaName,
        skipped: Boolean(result.skipped),
        resolvedPath: resolved.path,
      });
      return { ...result, resolvedPath: resolved.path };
    } catch (error) {
      sendToRenderer("ollama-import-error", {
        modelId,
        ollamaName,
        message: error.message || "导入 Ollama 失败",
      });
      throw error;
    }
  });

  ipcMain.handle("ollama:remove", async (_event, modelId) => {
    const model = getModelById(modelId);
    const ollamaName = resolveOllamaName(model);
    const result = await ollama.removeModel(ollamaName);
    sendToRenderer("ollama-removed", { modelId, ollamaName });
    return result;
  });

  ipcMain.handle("models:delete", async (_event, modelId) => {
    const model = getModelById(modelId);
    const ollamaName = resolveOllamaName(model);

    try {
      if (await ollama.isModelImported(ollamaName)) {
        await ollama.removeModel(ollamaName);
      }
    } catch {
      // continue removing local files even if ollama removal fails
    }

    await storage.deleteModelfile(model.id, getModelfilesDir());

    if (await storage.isModelDownloaded(model.filename)) {
      await storage.deleteModelFile(model.filename);
    }

    sendToRenderer("ollama-removed", { modelId, ollamaName });
    return { deleted: true, modelId };
  });

  ipcMain.handle("prompts:list", async () => {
    const settings = await settingsStore.load();
    const favoritePrompts = new Set(settings.favoritePrompts || []);
    return promptTemplates.map((item) => ({
      ...item,
      favorite: favoritePrompts.has(item.id),
    }));
  });

  ipcMain.handle("prompts:toggle-favorite", async (_event, promptId) => {
    await settingsStore.toggleFavoritePrompt(promptId);
    const settings = await settingsStore.load();
    const favoritePrompts = new Set(settings.favoritePrompts || []);
    return { promptId, favorite: favoritePrompts.has(promptId) };
  });

  ipcMain.handle("chat:sessions:list", async (_event, modelId) => chatSessions.list(modelId || null));

  ipcMain.handle("chat:sessions:search", async (_event, payload) =>
    chatSessions.search(payload.query, payload.modelId || null)
  );

  ipcMain.handle("chat:sessions:create", async (_event, payload) => {
    const model = getModelById(payload.modelId);
    return chatSessions.create({
      modelId: model.id,
      modelName: model.name,
      ollamaName: resolveOllamaName(model),
      systemPrompt: payload.systemPrompt || model.ollama?.system || "",
      title: payload.title || "新对话",
    });
  });

  ipcMain.handle("chat:sessions:get", async (_event, sessionId) => chatSessions.get(sessionId));

  ipcMain.handle("chat:sessions:rename", async (_event, payload) =>
    chatSessions.rename(payload.sessionId, payload.title)
  );

  ipcMain.handle("chat:sessions:delete", async (_event, sessionId) => chatSessions.delete(sessionId));

  ipcMain.handle("chat:sessions:set-prompt", async (_event, payload) =>
    chatSessions.updateSystemPrompt(payload.sessionId, payload.systemPrompt)
  );

  ipcMain.handle("chat:sessions:export", async (_event, sessionId) => {
    const session = await chatSessions.get(sessionId);
    const markdown = exportSessionToMarkdown(session);
    const safeName = (session.title || "对话").replace(/[<>:"/\\|?*]/g, "_").slice(0, 80);
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "导出聊天记录",
      defaultPath: `${safeName}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (canceled || !filePath) {
      return { saved: false };
    }
    await fs.writeFile(filePath, markdown, "utf8");
    return { saved: true, path: filePath };
  });

  ipcMain.handle("chat:send", async (_event, payload) => {
    const session = await chatSessions.get(payload.sessionId);

    if (payload.regenerate) {
      return runChatGeneration(payload.sessionId, true);
    }

    const message = payload.message?.trim();
    if (!message) {
      throw new Error("消息不能为空");
    }

    if (payload.editLastUser && session.messages.length) {
      const last = session.messages[session.messages.length - 1];
      if (last.role === "user") {
        last.content = message;
        while (session.messages.length && session.messages[session.messages.length - 1].role === "assistant") {
          session.messages.pop();
        }
        await chatSessions.setMessages(payload.sessionId, session.messages);
        return runChatGeneration(payload.sessionId, false);
      }
    }

    await chatSessions.appendMessage(payload.sessionId, {
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
    });

    return runChatGeneration(payload.sessionId, false);
  });

  ipcMain.handle("chat:stop", async (_event, sessionId) => ({
    stopped: ollama.abortChat(sessionId),
    sessionId,
  }));

  ipcMain.handle("app:version", async () => ({
    version: app.getVersion(),
    name: app.getName(),
  }));

  ipcMain.handle("power:shutdown-status", async () => powerControl.getStatus());
  ipcMain.handle("power:shutdown-schedule", async (_event, payload = {}) => {
    if (process.platform !== "win32") {
      throw new Error("定时关机目前仅支持 Windows");
    }
    return powerControl.scheduleShutdown(payload);
  });
  ipcMain.handle("power:shutdown-cancel", async () => {
    if (process.platform !== "win32") {
      throw new Error("定时关机目前仅支持 Windows");
    }
    return powerControl.cancelShutdown();
  });

  ipcMain.handle("app:check-update", async () => appUpdater.checkForUpdates({ manual: true }));

  ipcMain.handle("app:download-update", async () => appUpdater.downloadUpdate());

  ipcMain.handle("app:install-update", async () => {
    appUpdater.installUpdate();
    return { installing: true };
  });

  ipcMain.handle("models:catalog-info", async () => {
    const config = await repo.loadConfig();
    let userCatalog = null;
    if (repo.userCatalogPath && (await fs.pathExists(repo.userCatalogPath))) {
      userCatalog = await fs.readJson(repo.userCatalogPath);
    }
    return {
      syncUrl: config.syncUrl || null,
      catalogVersion: userCatalog?.catalogVersion || 0,
      modelCount: (await repo.loadModels()).length,
      lastSyncedAt: userCatalog?.lastSyncedAt || null,
    };
  });

  ipcMain.handle("dashboard:stats", async () => {
    const settings = await settingsStore.load();
    const models = await buildModelList();
    const sessions = await chatSessions.list();
    const queue = downloader.getQueueSnapshot();

    const modelMap = new Map(models.map((item) => [item.id, item]));
    const recentDownloads = settings.recentDownloads.slice(0, 5).map((item) => {
      const model = modelMap.get(item.modelId);
      return {
        modelId: item.modelId,
        name: model?.name || item.modelId,
        downloadedAt: item.downloadedAt,
      };
    });

    const recentSessions = sessions.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      modelName: item.modelName,
      updatedAt: item.updatedAt,
    }));

    const recentImported = models
      .filter((item) => item.ollamaImported)
      .slice(0, 5)
      .map((item) => ({ modelId: item.id, name: item.name }));

    return {
      recentDownloads,
      recentSessions,
      recentImported,
      queueCount: queue.length,
      version: app.getVersion(),
    };
  });

  ipcMain.handle("app:open-logs", async () => {
    const logDir = path.join(app.getPath("userData"), "logs");
    await shell.openPath(logDir);
    return logDir;
  });

  ipcMain.handle("pai:get-status", async () => {
    const settings = await settingsStore.load();
    return paiBridge.getStatus(settings);
  });

  ipcMain.handle("pai:ensure", async () => {
    const settings = await settingsStore.load();
    return paiBridge.ensureRunning(settings, logger);
  });

  ipcMain.handle("pai:run", async (_event, payload) => {
    const settings = await settingsStore.load();
    if (!(await paiBridge.ping(settings))) {
      await paiBridge.ensureRunning(settings, logger);
    }
    const command = payload?.command;
    if (!command || typeof command !== "string") {
      throw new Error("命令不能为空");
    }
    const level = payload?.level ?? settings.paiDefaultLevel ?? 1;
    return paiBridge.run(settings, command.trim(), level);
  });

  ipcMain.handle("pai:doctor", async () => {
    const settings = await settingsStore.load();
    if (!(await paiBridge.ping(settings))) {
      await paiBridge.ensureRunning(settings, logger);
    }
    return paiBridge.doctor(settings);
  });

  ipcMain.handle("env:scan", async (_event, options) => {
    const settings = await settingsStore.load();
    return scanLocalEnvironment({
      paiBridge,
      ollamaService: ollama,
      settings,
      logger,
      includeAppScan: options?.includeAppScan !== false,
      includeDoctor: options?.includeDoctor !== false,
    });
  });

  ipcMain.handle("comfyui:status", async () => {
    const settings = await settingsStore.load();
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    return getComfyUiStatus(paiRoot);
  });

  ipcMain.handle("comfyui:open-ui", async () => {
    const settings = await settingsStore.load();
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    return openComfyUiInBrowser(paiRoot);
  });

  ipcMain.handle("comfyui:progress", async (_event, payload) => {
    const settings = await settingsStore.load();
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    return getProgressSnapshot(paiRoot, payload || {});
  });

  ipcMain.handle("studio:cancel", async () => {
    const settings = await settingsStore.load();
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    return interruptComfyUi(paiRoot);
  });

  ipcMain.handle("pai:catalog", async () => {
    const settings = await settingsStore.load();
    if (!(await paiBridge.ping(settings))) {
      await paiBridge.ensureRunning(settings, logger);
    }
    return paiBridge.fetchCatalog(settings);
  });

  ipcMain.handle("pai:presets", async () => {
    const settings = await settingsStore.load();
    if (!(await paiBridge.ping(settings))) {
      await paiBridge.ensureRunning(settings, logger);
    }
    return paiBridge.fetchPresets(settings);
  });

  ipcMain.handle("pai:capabilities", async () => {
    const settings = await settingsStore.load();
    if (!(await paiBridge.ping(settings))) {
      await paiBridge.ensureRunning(settings, logger);
    }
    return paiBridge.fetchCapabilities(settings);
  });

  ipcMain.handle("pai:run-tracked", async (event, payload) => {
    const settings = await settingsStore.load();
    if (!(await paiBridge.ping(settings))) {
      await paiBridge.ensureRunning(settings, logger);
    }

    const command = payload?.command;
    if (!command || typeof command !== "string") {
      throw new Error("命令不能为空");
    }

    const level = payload?.level ?? settings.paiDefaultLevel ?? 1;
    const runId = payload?.runId || `run-${Date.now()}`;
    const pollMs = Math.max(1000, Number(settings.comfyUiPollIntervalMs) || 2500);
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    const startedAt = Date.now();
    let promptId = payload?.promptId || null;

    let baselineIds = new Set();
    try {
      const configured = await getComfyUiStatus(paiRoot);
      if (configured?.api && configured.running) {
        const queueData = await fetchQueue(configured.api);
        baselineIds = collectPromptIds(queueData);
      }
    } catch (error) {
      logger?.warn("出片前进度基线失败", { message: error.message });
    }

    const emitProgress = async (extra = {}) => {
      try {
        const snap = await getProgressSnapshot(paiRoot, {
          promptId,
          baselineIds,
          startedAt,
        });
        if (snap.promptId && !promptId) {
          promptId = snap.promptId;
        }
        event.sender.send("pai-run-progress", { runId, ...snap, ...extra });
      } catch (error) {
        event.sender.send("pai-run-progress", {
          runId,
          ok: false,
          phase: "offline",
          message: error.message,
          elapsedMs: Date.now() - startedAt,
        });
      }
    };

    await emitProgress({ phase: "submitting", message: "正在提交 PAI…" });

    const pollTimer = setInterval(() => {
      emitProgress().catch(() => {});
    }, pollMs);

    try {
      const result = await paiBridge.run(settings, command.trim(), level);
      await emitProgress({ done: true, resultOk: result?.ok === true });
      return { runId, result };
    } finally {
      clearInterval(pollTimer);
    }
  });

  ipcMain.handle("env:apply-comfyui", async (_event, payload) => {
    const settings = await settingsStore.load();
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    const candidate = payload?.comfyui;
    if (!candidate?.path) {
      throw new Error("未提供 ComfyUI 路径");
    }
    const result = applyComfyUiToPai(paiRoot, candidate);
    logger.info("已写入 ComfyUI 配置到 PAI", result);
    return result;
  });

  ipcMain.handle("setup:status", async () => {
    const settings = await settingsStore.load();
    return getSetupStatus({
      paiBridge,
      ollamaService: ollama,
      settings,
      userDataPath: app.getPath("userData"),
      logger,
    });
  });

  ipcMain.handle("setup:refresh-network", async () => applyProxyPolicy());

  ipcMain.handle("setup:install-ollama", async () => {
    return installOllama({
      onProgress: (payload) => sendToRenderer("setup-progress", { target: "ollama", ...payload }),
    });
  });

  ipcMain.handle("setup:install-pai", async () => {
    const settings = await settingsStore.load();
    const result = await installPaiRuntime({
      userDataPath: app.getPath("userData"),
      runtimeUrl: settings.paiRuntimeUrl || undefined,
      onProgress: (payload) => sendToRenderer("setup-progress", { target: "pai", ...payload }),
    });
    if (result.ok && result.paiRoot) {
      await settingsStore.update({ paiRoot: result.paiRoot });
      try {
        await paiBridge.ensureRunning({ ...settings, paiRoot: result.paiRoot }, logger);
      } catch (error) {
        result.serveError = error.message;
      }
    }
    return result;
  });

  ipcMain.handle("setup:pick-pai-root", async () => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: "选择 PAI 根目录",
      properties: ["openDirectory"],
    });
    if (picked.canceled || !picked.filePaths?.[0]) {
      return { ok: false, cancelled: true };
    }
    const root = picked.filePaths[0];
    const bound = await bindPaiRoot(root);
    await settingsStore.update({ paiRoot: bound.paiRoot });
    return bound;
  });

  ipcMain.handle("setup:open-comfy-guide", async () => {
    const settings = await settingsStore.load();
    return openComfyGuide(settings.comfyUiDownloadUrl || undefined);
  });

  ipcMain.handle("setup:scan-comfyui", async () => {
    const settings = await settingsStore.load();
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    if (!(await fs.pathExists(path.join(paiRoot, "config", "pai.yaml")))) {
      throw new Error("请先安装或绑定 PAI 引擎，再扫描 ComfyUI");
    }
    return scanAndApplyComfyUi(paiRoot, logger);
  });

  ipcMain.handle("setup:install-ffmpeg", async () => {
    return installFfmpeg({
      onProgress: (payload) => sendToRenderer("setup-progress", { target: "ffmpeg", ...payload }),
    });
  });

  ipcMain.handle("setup:dismiss-wizard", async () => {
    await settingsStore.update({ showSetupWizard: false });
    return { ok: true };
  });

  ipcMain.handle("studio:get-pipeline", async () => studioStore.load());
  ipcMain.handle("studio:save-pipeline", async (_event, partial) => studioStore.update(partial || {}));

  ipcMain.handle("studio:add-custom-tool", async () => {
    const desktop = app.getPath("desktop");
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: "选择剪辑工具（可从桌面选快捷方式或 .exe）",
      defaultPath: desktop,
      properties: ["openFile"],
      filters: [
        { name: "程序 / 快捷方式", extensions: ["exe", "bat", "cmd", "lnk"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (picked.canceled || !picked.filePaths?.[0]) {
      return { ok: false, cancelled: true };
    }

    let exePath = picked.filePaths[0];
    let defaultName = path.basename(exePath, path.extname(exePath));
    if (path.extname(exePath).toLowerCase() === ".lnk") {
      try {
        const info = shell.readShortcutLink(exePath);
        if (info?.target) {
          exePath = info.target;
          defaultName = path.basename(exePath, path.extname(exePath)) || defaultName;
        }
      } catch (error) {
        throw new Error(`无法读取快捷方式：${error.message}`);
      }
    }

    const nameResult = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["用这个名字", "取消"],
      defaultId: 0,
      cancelId: 1,
      title: "添加工具",
      message: `将添加后期工具：\n${defaultName}\n\n路径：${exePath}`,
      detail: "出片完成后会用该程序打开成品视频。可在工具列表里选中后点「移除」。",
    });
    if (nameResult.response !== 0) {
      return { ok: false, cancelled: true };
    }

    return studioStore.addCustomTool({ name: defaultName, path: exePath });
  });

  ipcMain.handle("studio:remove-custom-tool", async (_event, toolId) => {
    return studioStore.removeCustomTool(toolId);
  });

  ipcMain.handle("studio:media-url", async (_event, filePath) => {
    const abs = path.resolve(String(filePath || ""));
    if (!(await fs.pathExists(abs))) {
      throw new Error(`文件不存在：${abs}`);
    }
    const ext = path.extname(abs).toLowerCase();
    const kind = [".mp4", ".webm", ".mov", ".mkv", ".avi", ".gif"].includes(ext)
      ? "video"
      : [".png", ".jpg", ".jpeg", ".webp", ".bmp"].includes(ext)
        ? "image"
        : "file";

    // 图片用 data URL，避免自定义协议在 img 上加载失败
    if (kind === "image") {
      const buf = await fs.readFile(abs);
      const mime =
        ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".bmp"
              ? "image/bmp"
              : "image/png";
      return {
        ok: true,
        path: abs,
        url: `data:${mime};base64,${buf.toString("base64")}`,
        kind,
      };
    }

    return { ok: true, path: abs, url: toMoguMediaUrl(abs), kind };
  });

  ipcMain.handle("studio:pick-image", async () => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: "选择参考照片",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
    });
    if (picked.canceled || !picked.filePaths?.[0]) {
      return { ok: false, cancelled: true };
    }
    const imagePath = picked.filePaths[0];
    await studioStore.update({ imagePath });
    return { ok: true, imagePath };
  });

  ipcMain.handle("studio:import-workflow", async (_event, payload) => {
    const settings = await settingsStore.load();
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    const workflowsDir = path.join(paiRoot, "workflows");
    await fs.ensureDir(workflowsDir);
    let source = payload?.filePath;
    if (!source) {
      const picked = await dialog.showOpenDialog(mainWindow, {
        title: "选择工作流 JSON",
        properties: ["openFile"],
        filters: [{ name: "ComfyUI Workflow", extensions: ["json"] }],
      });
      if (picked.canceled || !picked.filePaths?.[0]) {
        return { ok: false, cancelled: true };
      }
      source = picked.filePaths[0];
    }
    const dest = path.join(workflowsDir, path.basename(source));
    await fs.copy(source, dest);
    try {
      await paiBridge.run(settings, "同步工作流", 1);
    } catch {
      // catalog sync best-effort
    }
    return { ok: true, path: dest, name: path.basename(source, ".json") };
  });

  ipcMain.handle("pai:studio-run", async (_event, payload) => {
    const settings = await settingsStore.load();
    await paiBridge.ensureRunning(settings, logger);
    const runId = payload?.runId || `studio-${Date.now()}`;
    sendToRenderer("pai-run-progress", {
      runId,
      phase: "submitting",
      message: "创作台任务提交中…",
    });
    try {
      const result = await paiBridge.runStudio(settings, {
        ...payload,
        level: payload?.level ?? 2,
      });
      // 短片出片不再自动打开剪辑工具；长片请到「视频合成」
      const tool = String(payload?.tool || "none").toLowerCase();
      if (result?.ok && result?.path && tool && tool !== "none") {
        const pipeline = await studioStore.load();
        result.postTool = await openStudioPostTool(payload?.tool, result.path, pipeline.customTools || []);
      }
      sendToRenderer("pai-run-progress", {
        runId,
        phase: result?.ok ? "completed" : "failed",
        message: result?.message || result?.error || (result?.ok ? "完成" : "失败"),
        path: result?.path,
      });
      return { runId, result };
    } catch (error) {
      sendToRenderer("pai-run-progress", {
        runId,
        phase: "failed",
        message: error.message,
      });
      throw error;
    }
  });

  ipcMain.handle("compose:list-clips", async () => {
    const settings = await settingsStore.load();
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    const roots = [
      path.join(paiRoot, "output", "final"),
      path.join(paiRoot, "output"),
    ];
    const exts = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi", ".gif"]);
    const seen = new Set();
    const clips = [];
    for (const root of roots) {
      if (!(await fs.pathExists(root))) continue;
      let entries = [];
      try {
        entries = await fs.readdir(root);
      } catch {
        continue;
      }
      for (const name of entries) {
        const full = path.join(root, name);
        if (seen.has(full)) continue;
        const ext = path.extname(name).toLowerCase();
        if (!exts.has(ext)) continue;
        try {
          const st = await fs.stat(full);
          if (!st.isFile()) continue;
          seen.add(full);
          clips.push({
            path: full,
            name,
            sizeBytes: st.size,
            mtimeMs: st.mtimeMs,
          });
        } catch {
          /* skip */
        }
      }
    }
    clips.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return { ok: true, clips: clips.slice(0, 40), outputDir: roots[0] };
  });

  ipcMain.handle("compose:pick-media", async () => {
    const settings = await settingsStore.load();
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    const finalDir = path.join(paiRoot, "output", "final");
    const outputDir = path.join(paiRoot, "output");
    const defaultPath = (await fs.pathExists(finalDir))
      ? finalDir
      : (await fs.pathExists(outputDir))
        ? outputDir
        : undefined;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择要加入时间线的视频",
      defaultPath,
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "视频", extensions: ["mp4", "webm", "mov", "mkv", "avi", "gif"] },
        { name: "全部", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths?.length) {
      return { cancelled: true, paths: [] };
    }
    return { cancelled: false, paths: result.filePaths };
  });

  ipcMain.handle("compose:open-tool", async (_event, payload = {}) => {
    const pipeline = await studioStore.load();
    const tool = payload.tool || pipeline.tool || "shotcut";
    const mediaPath = payload.path || payload.mediaPath || "";
    if (!mediaPath) {
      const settings = await settingsStore.load();
      const paiRoot = paiBridge.resolvePaiRoot(settings);
      const folder = path.join(paiRoot, "output", "final");
      const target = (await fs.pathExists(folder)) ? folder : path.join(paiRoot, "output");
      await shell.openPath(target);
      return { ok: true, message: `已打开成品目录：${target}` };
    }
    return openStudioPostTool(tool, mediaPath, pipeline.customTools || []);
  });

  ipcMain.handle("compose:open-output-folder", async () => {
    const settings = await settingsStore.load();
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    const folder = path.join(paiRoot, "output", "final");
    const target = (await fs.pathExists(folder)) ? folder : path.join(paiRoot, "output");
    await fs.ensureDir(target);
    await shell.openPath(target);
    return { ok: true, path: target };
  });

  ipcMain.handle("compose:ensure-ffmpeg", async () => {
    const { ensureFfmpeg } = require("./ffmpeg-tools");
    return ensureFfmpeg({
      onProgress: (payload) => sendToRenderer("compose-progress", payload),
    });
  });

  ipcMain.handle("compose:concat", async (_event, payload = {}) => {
    const { concatVideos } = require("./ffmpeg-tools");
    const paths = Array.isArray(payload.paths) ? payload.paths : [];
    const settings = await settingsStore.load();
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    const outDir = path.join(paiRoot, "output", "final");
    await fs.ensureDir(outDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outputPath = path.join(outDir, `compose_${stamp}.mp4`);
    const result = await concatVideos(paths, {
      outputPath,
      onProgress: (payloadProgress) => sendToRenderer("compose-progress", payloadProgress),
    });
    return result;
  });
}

async function findShotcutExe() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Shotcut", "shotcut.exe"),
    path.join(process.env.ProgramFiles || "", "Shotcut", "shotcut.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Shotcut", "shotcut.exe"),
  ];
  for (const candidate of candidates) {
    if (candidate && (await fs.pathExists(candidate))) return candidate;
  }
  return null;
}

async function openStudioPostTool(tool, mediaPath, customTools = []) {
  const chosen = String(tool || "none");
  const chosenLower = chosen.toLowerCase();
  if (!mediaPath || chosenLower === "none" || chosen === "无") {
    return { tool: "none", ok: true, message: "已出片（未打开后期工具）" };
  }

  const abs = path.resolve(mediaPath);
  const folder = path.dirname(abs);

  if (chosen.startsWith("custom:") || chosenLower.startsWith("custom:")) {
    const id = chosen.slice("custom:".length);
    const custom = (customTools || []).find((t) => t.id === id);
    if (!custom?.path) {
      await shell.openPath(folder);
      return { tool: chosen, ok: false, message: "自定义工具不存在，已打开成品目录" };
    }
    if (!(await fs.pathExists(custom.path))) {
      await shell.openPath(folder);
      return {
        tool: chosen,
        ok: false,
        message: `找不到 ${custom.name}（${custom.path}），已打开成品目录`,
      };
    }
    spawn(custom.path, [abs], { detached: true, stdio: "ignore" }).unref();
    return { tool: chosen, ok: true, message: `已用 ${custom.name} 打开：${abs}` };
  }

  if (chosenLower === "shotcut") {
    const exe = await findShotcutExe();
    if (!exe) {
      await shell.openPath(folder);
      return {
        tool: "shotcut",
        ok: false,
        message: "未找到 Shotcut，已打开成品目录。请安装 Shotcut 或到环境页检查。",
      };
    }
    spawn(exe, [abs], { detached: true, stdio: "ignore" }).unref();
    return { tool: "shotcut", ok: true, message: `已用 Shotcut 打开：${abs}` };
  }

  if (chosenLower === "ffmpeg") {
    await shell.openPath(folder);
    return {
      tool: "ffmpeg",
      ok: true,
      message: `已打开成品目录。FFmpeg 无窗口，可在 Agent 说「用 ffmpeg 处理该视频」，或本机命令行调用。`,
    };
  }

  if (chosenLower === "jianying" || chosen === "剪映") {
    await shell.openPath(folder);
    return { tool: "jianying", ok: true, message: `已打开成品目录（剪映）：${folder}` };
  }

  return { tool: chosen, ok: true, message: `后期工具：${chosen}` };
}

function toMoguMediaUrl(filePath) {
  const abs = path.resolve(filePath);
  return `mogu-media://local/?p=${encodeURIComponent(abs)}`;
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  protocol.handle("mogu-media", (request) => {
    try {
      const parsed = new URL(request.url);
      const filePath = path.normalize(parsed.searchParams.get("p") || "");
      if (!filePath || !fs.existsSync(filePath)) {
        return new Response("not found", { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).href);
    } catch (error) {
      return new Response(`media error: ${error.message}`, { status: 400 });
    }
  });

  initServices();

  await logger.initialize();
  await applyProxyPolicy();
  await chatSessions.initialize();

  const settings = await settingsStore.load();
  if (settings.modelStoragePath) {
    try {
      await storage.setStorageDir(settings.modelStoragePath);
    } catch (error) {
      logger.warn("恢复模型保存路径失败", { message: error.message });
    }
  }

  registerIpcHandlers();

  appUpdater = initAutoUpdater({
    logger,
    sendToRenderer,
    getSettings: () => settingsStore.load(),
    appPath: app.getAppPath(),
  });
  await appUpdater.configureFeed();

  createWindow();
  logger.info("应用启动", { version: app.getVersion() });

  // Returning from v2rayN: re-read system proxy without full restart
  let proxyFocusTimer = null;
  app.on("browser-window-focus", () => {
    clearTimeout(proxyFocusTimer);
    proxyFocusTimer = setTimeout(() => {
      applyProxyPolicy().catch(() => {});
    }, 400);
  });

  process.on("uncaughtException", (error) => {
    logger.error("未捕获异常", { message: error.message, stack: error.stack });
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("未处理的 Promise 拒绝", { reason: String(reason) });
  });

  if (settings.autoStartOllama) {
    try {
      const ollamaStatus = await ollama.getStatus();
      if (ollamaStatus.installed && !ollamaStatus.running) {
        await ollama.startServe();
        logger.info("已自动启动 Ollama");
      }
    } catch (error) {
      logger.warn("自动启动 Ollama 失败", { message: error.message });
    }
  }

  if (settings.autoStartPai) {
    try {
      const paiStatus = await paiBridge.getStatus(settings);
      if (paiStatus.installed && !paiStatus.running) {
        await paiBridge.ensureRunning(settings, logger);
        logger.info("已自动启动 PAI 管家服务");
      }
    } catch (error) {
      logger.warn("自动启动 PAI 失败", { message: error.message });
    }
  }

  try {
    await repo.ensureUserCatalogSeeded();
  } catch (error) {
    logger.warn("初始化模型 catalog 失败", { message: error.message });
  }

  if (settings.autoSyncOnStartup) {
    try {
      const syncResult = await repo.syncRemoteCatalog();
      if (syncResult.synced) {
        logger.info("模型库已同步", syncResult);
      }
    } catch (error) {
      logger.warn("启动时同步模型库失败", { message: error.message });
    }
  }

  await downloader.initialize();
  await refreshAllModels();

  if (settings.autoCheckUpdates !== false) {
    setTimeout(() => {
      appUpdater.checkForUpdates().catch(() => {});
    }, 8000);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (paiBridge) {
    paiBridge.shutdown();
  }
});

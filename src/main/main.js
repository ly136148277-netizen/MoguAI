const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require("electron");
const path = require("path");
const fs = require("fs-extra");

const { ModelRepository } = require("./repo");
const { StorageManager } = require("./storage");
const { DownloadEngine } = require("./download-engine");
const { OllamaService, resolveOllamaName, OLLAMA_INSTALL_URL } = require("./ollama");
const { SettingsStore } = require("./settings");
const { listMirrorOptions } = require("./mirrors");
const { ChatSessionStore, exportSessionToMarkdown } = require("./chat-sessions");
const { Logger } = require("./logger");
const { PaiBridge } = require("./pai-bridge");
const { getComfyUiStatus, fetchQueue, collectPromptIds, getProgressSnapshot } = require("./comfyui-bridge");
const { scanLocalEnvironment, applyComfyUiToPai } = require("./env-scan");
const { initAutoUpdater } = require("./updater");

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
let allModelsCache = [];
let promptTemplates = [];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    title: "蘑菇AI",
    autoHideMenuBar: true,
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
      title: "选择模型保存位置",
      message: "请选中目标文件夹，再点击窗口底部的「选择文件夹」按钮确认",
      buttonLabel: "选择此文件夹",
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

  ipcMain.handle("comfyui:progress", async (_event, payload) => {
    const settings = await settingsStore.load();
    const paiRoot = paiBridge.resolvePaiRoot(settings);
    return getProgressSnapshot(paiRoot, payload || {});
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
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  initServices();

  await logger.initialize();
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

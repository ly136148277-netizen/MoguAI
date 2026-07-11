const { autoUpdater } = require("electron-updater");
const fs = require("fs-extra");
const path = require("path");

function initAutoUpdater({ logger, sendToRenderer, getSettings, appPath }) {
  let feedConfigured = false;

  async function configureFeed() {
    try {
      const updatePath = path.join(appPath, "config", "update.json");
      if (!(await fs.pathExists(updatePath))) {
        return false;
      }
      const config = await fs.readJson(updatePath);
      if (config.provider === "github" && config.owner && config.repo) {
        autoUpdater.setFeedURL({
          provider: "github",
          owner: config.owner,
          repo: config.repo,
        });
        feedConfigured = true;
        return true;
      }
      if (!config.url) {
        return false;
      }
      autoUpdater.setFeedURL({
        provider: config.provider || "generic",
        url: config.url,
      });
      feedConfigured = true;
      return true;
    } catch (error) {
      logger?.warn?.("读取更新配置失败", { message: error.message });
      return false;
    }
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message) => logger?.info?.(message),
    warn: (message) => logger?.warn?.(message),
    error: (message) => logger?.error?.(message),
  };

  autoUpdater.on("update-available", (info) => {
    sendToRenderer("app-update-available", {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("update-not-available", () => {
    sendToRenderer("app-update-not-available", {});
  });

  autoUpdater.on("download-progress", (progress) => {
    sendToRenderer("app-update-progress", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendToRenderer("app-update-downloaded", {
      version: info.version,
    });
  });

  autoUpdater.on("error", (error) => {
    logger?.warn?.("自动更新检查失败", { message: error.message });
    sendToRenderer("app-update-error", { message: error.message });
  });

  async function checkForUpdates({ manual = false } = {}) {
    const settings = await getSettings();
    if (!manual && settings.autoCheckUpdates === false) {
      return { skipped: true, reason: "已关闭自动检查更新" };
    }

    if (!feedConfigured) {
      await configureFeed();
    }

    if (!feedConfigured) {
      return { skipped: true, reason: "未配置更新源（见 docs/RELEASE.md）" };
    }

    const result = await autoUpdater.checkForUpdates();
    return { checking: true, updateInfo: result?.updateInfo || null };
  }

  async function downloadUpdate() {
    await autoUpdater.downloadUpdate();
    return { downloading: true };
  }

  function installUpdate() {
    autoUpdater.quitAndInstall(false, true);
  }

  return { configureFeed, checkForUpdates, downloadUpdate, installUpdate };
}

module.exports = { initAutoUpdater };

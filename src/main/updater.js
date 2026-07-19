const { autoUpdater } = require("electron-updater");
const fs = require("fs-extra");
const path = require("path");

function initAutoUpdater({ logger, sendToRenderer, getSettings, appPath, getAppVersion }) {
  let feedConfigured = false;
  let feedInfo = null;
  let lastCheck = null;

  async function readFeedConfig() {
    const updatePath = path.join(appPath, "config", "update.json");
    if (!(await fs.pathExists(updatePath))) return null;
    return fs.readJson(updatePath);
  }

  async function configureFeed() {
    try {
      const config = await readFeedConfig();
      if (!config) {
        feedInfo = null;
        return false;
      }
      if (config.provider === "github" && config.owner && config.repo) {
        autoUpdater.setFeedURL({
          provider: "github",
          owner: config.owner,
          repo: config.repo,
        });
        feedConfigured = true;
        feedInfo = {
          provider: "github",
          owner: config.owner,
          repo: config.repo,
          url: `https://github.com/${config.owner}/${config.repo}/releases`,
          notes: config.notes || "",
        };
        return true;
      }
      if (!config.url) {
        feedInfo = null;
        return false;
      }
      autoUpdater.setFeedURL({
        provider: config.provider || "generic",
        url: config.url,
      });
      feedConfigured = true;
      feedInfo = {
        provider: config.provider || "generic",
        url: config.url,
        notes: config.notes || "",
      };
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
      lastCheck = { at: new Date().toISOString(), skipped: true, reason: "已关闭自动检查更新" };
      return lastCheck;
    }

    if (!feedConfigured) {
      await configureFeed();
    }

    if (!feedConfigured) {
      lastCheck = { at: new Date().toISOString(), skipped: true, reason: "未配置更新源（见 docs/RELEASE.md）" };
      return lastCheck;
    }

    const result = await autoUpdater.checkForUpdates();
    lastCheck = {
      at: new Date().toISOString(),
      checking: true,
      updateInfo: result?.updateInfo || null,
      version: result?.updateInfo?.version || null,
    };
    return lastCheck;
  }

  async function downloadUpdate() {
    await autoUpdater.downloadUpdate();
    return { downloading: true };
  }

  function installUpdate() {
    autoUpdater.quitAndInstall(false, true);
  }

  async function getStatus() {
    if (!feedConfigured) await configureFeed();
    const version =
      (typeof getAppVersion === "function" ? getAppVersion() : null) ||
      process.env.npm_package_version ||
      "unknown";
    return {
      ok: true,
      currentVersion: version,
      feedConfigured,
      feed: feedInfo,
      lastCheck,
      // Windows Authenticode: package.json currently has signAndEditExecutable:false
      codeSigning: {
        enabled: false,
        mode: "unsigned_dev_pipeline",
        message:
          "当前安装包按未签名流水线构建（可更新，SmartScreen 可能提示）。发正式客户包前按 docs/RELEASE.md「代码签名」启用证书。",
        checklist: [
          "准备 EV/OV 代码签名证书（或云签）",
          "设置 CSC_LINK / CSC_KEY_PASSWORD（或 Azure Trusted Signing）",
          "将 package.json build.win.signAndEditExecutable 改为 true",
          "跑 npm run preflight:release 并验证安装包签名属性",
        ],
      },
      channel: "github-releases",
    };
  }

  return { configureFeed, checkForUpdates, downloadUpdate, installUpdate, getStatus };
}

module.exports = { initAutoUpdater };

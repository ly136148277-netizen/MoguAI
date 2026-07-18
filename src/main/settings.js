const fs = require("fs-extra");
const path = require("path");

const DEFAULT_SETTINGS = {
  schemaVersion: 2,
  downloadThreads: 4,
  maxConcurrentDownloads: 2,
  mirror: "official",
  customMirrorUrl: "",
  favorites: [],
  recentDownloads: [],
  autoSyncOnStartup: true,
  autoCheckUpdates: true,
  autoStartOllama: false,
  modelStoragePath: "",
  paiRoot: "",
  paiApiUrl: "http://127.0.0.1:8765",
  paiRuntimeUrl: "",
  comfyUiDownloadUrl: "",
  autoStartPai: true,
  paiDefaultLevel: 2,
  comfyUiPollIntervalMs: 2500,
  showSetupWizard: true,
  showWelcomeCard: true,
  theme: "dark",
  locale: "zh",
  favoritePrompts: [],
  /** Agent 引导脑子：builtin | local | api */
  agentBrainChannel: "builtin",
  agentLocalModel: "",
  agentApiPreset: "deepseek",
  agentApiBaseUrl: "https://api.deepseek.com/v1",
  agentApiKey: "",
  agentApiModel: "deepseek-chat",
  /** Agent runtime: pai | openclaw */
  agentRuntimeMode: "pai",
  openclawEnabled: false,
  openclawGatewayUrl: "ws://127.0.0.1:18789",
  openclawFallbackToPai: true,
  /** Skill enable map: { "mogu.comfy": true, ... } */
  skillsEnabled: {
    "mogu.comfy": true,
    "mogu.studio": true,
    "mogu.ollama": true,
    "mogu.pc": true,
    "mogu.media": true,
  },
};

class SettingsStore {
  constructor(settingsPath) {
    this.settingsPath = settingsPath;
    this._cache = null;
  }

  async load() {
    if (this._cache) {
      return this._cache;
    }

    if (await fs.pathExists(this.settingsPath)) {
      const saved = await fs.readJson(this.settingsPath);
      this._cache = { ...DEFAULT_SETTINGS, ...saved };
      return this._cache;
    }

    this._cache = { ...DEFAULT_SETTINGS };
    await this.save();
    return this._cache;
  }

  async save(nextSettings = null) {
    if (nextSettings) {
      this._cache = { ...DEFAULT_SETTINGS, ...nextSettings };
    }

    // Never persist API keys in settings.json (handled by SecretStore).
    if (this._cache && Object.prototype.hasOwnProperty.call(this._cache, "agentApiKey")) {
      this._cache.agentApiKey = "";
    }
    if (this._cache) {
      this._cache.schemaVersion = this._cache.schemaVersion || DEFAULT_SETTINGS.schemaVersion;
    }

    await fs.ensureDir(path.dirname(this.settingsPath));
    const tmp = `${this.settingsPath}.${process.pid}.tmp`;
    await fs.writeJson(tmp, this._cache, { spaces: 2 });
    await fs.move(tmp, this.settingsPath, { overwrite: true });
    return this._cache;
  }

  async update(partial) {
    const current = await this.load();
    return this.save({ ...current, ...partial });
  }

  async toggleFavorite(modelId) {
    const settings = await this.load();
    const favorites = new Set(settings.favorites);
    if (favorites.has(modelId)) {
      favorites.delete(modelId);
    } else {
      favorites.add(modelId);
    }
    return this.update({ favorites: [...favorites] });
  }

  async addRecentDownload(modelId) {
    const settings = await this.load();
    const recent = settings.recentDownloads.filter((item) => item.modelId !== modelId);
    recent.unshift({ modelId, downloadedAt: new Date().toISOString() });
    return this.update({ recentDownloads: recent.slice(0, 100) });
  }

  async getFavorites() {
    const settings = await this.load();
    return new Set(settings.favorites);
  }

  async toggleFavoritePrompt(promptId) {
    const settings = await this.load();
    const favorites = new Set(settings.favoritePrompts || []);
    if (favorites.has(promptId)) {
      favorites.delete(promptId);
    } else {
      favorites.add(promptId);
    }
    return this.update({ favoritePrompts: [...favorites] });
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS };

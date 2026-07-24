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
  /** Public clean profile: never auto-start a discovered private PAI runtime */
  autoStartPai: false,
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
  /** Agent runtime: pai | openclaw — v2.0 default OpenClaw */
  agentRuntimeMode: "openclaw",
  openclawEnabled: true,
  openclawGatewayUrl: "ws://127.0.0.1:18789",
  /** Public Release: no silent PAI fallback unless the user opts in */
  openclawFallbackToPai: false,
  /** Skill enable map: { "mogu.comfy": true, ... } */
  skillsEnabled: {
    "mogu.comfy": true,
    "mogu.studio": true,
    "mogu.ollama": true,
    "mogu.pc": true,
    "mogu.media": true,
    "mogu.coding": true,
    "mogu.search": true,
    "mogu.browser": true,
    "mogu.memory": true,
  },
  /** MOGU AI coding engines: moguai_a | moguai_b */
  codingDefaultEngine: "moguai_a",
  codingWorkspace: "",
  codingEngineAPath: "",
  codingEngineBPath: "",
  codingVendorRoot: "",
  moguaiRuntimeRoot: "",
  codingModel: "",
  codingProvider: "",
  codingSandbox: "",
  /** MOGU 2.1 capability gates remain independently opt-in. */
  v21RepoIntelligence: false,
  v21Lsp: false,
  v21ControlledTerminal: false,
  v21ParallelWorktrees: false,
  v21RecoverableRuntime: false,
  v21Gpt56Adapter: false,
  /** MOGU 2.2 Neural Layer gates remain independently opt-in. */
  v22NeuralLayer: false,
  v22ModelRouting: false,
  v22Planner: false,
  v22ContextBudget: false,
  v22ToolChain: false,
  v22DecisionTrace: false,
  v22ClosedLoop: false,
  /** User-registered, pinned LSP launch metadata. Never auto-installed or updated. */
  v22LspServers: [],
  /** Routing metadata only. Provider credentials remain outside settings.json. */
  v22Config: {
    modelProfiles: [],
    taskPolicies: [],
    budget: {
      maxInputTokens: null,
      maxOutputTokens: null,
      maxToolCalls: null,
      maxSteps: null,
      maxRepairIterations: null,
      maxWallTimeMs: null,
      maxCostUsd: null,
    },
    allowModelFallback: false,
  },
  /** Provider-neutral adapter config. Credentials always live in SecretStore. */
  v21Gpt56AdapterConfig: {
    provider: "",
    endpoint: "",
    modelId: "",
    secretId: "agentApiKey",
    capabilities: { tools: true, jsonMode: false },
    sampling: { temperature: 0.3, topP: null, seed: null },
    limits: {
      timeoutMs: 90000,
      maxSteps: 4,
      maxOutputTokens: 4096,
      maxRequestBytes: 2097152,
      maxResponseBytes: 4194304,
      maxToolArgumentsBytes: 65536,
      maxCostUsd: null,
    },
  },
  /** Optional Playwright package root for mogu.browser */
  browserPlaywrightPath: "",
  /**
   * MCP stdio servers exposed to the brain as mcp__{id}__{tool} tools.
   * Example: [{ id: "fs", label: "Filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "REPLACE_WITH_SAFE_FOLDER"], enabled: true }]
   */
  mcpServers: [],
  /** MOGU 2.3 Remote Workspace — message-driven task source. Default OFF. */
  remote: {
    enabled: false,
    telegram: false,
    qq: false,
    wechat: false,
    requireApproval: true,
    allowAutoExecute: false,
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
      this._cache.v22Config = sanitizeV22Config(saved.v22Config);
      this._cache.v22LspServers = sanitizeV22LspServers(saved.v22LspServers);
      this._cache.remote = sanitizeRemoteSettings(saved.remote);
      return this._cache;
    }

    this._cache = { ...DEFAULT_SETTINGS };
    this._cache.v22Config = sanitizeV22Config();
    this._cache.v22LspServers = [];
    this._cache.remote = sanitizeRemoteSettings();
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
    if (this._cache?.v21Gpt56AdapterConfig) {
      this._cache.v21Gpt56AdapterConfig = sanitizeAdapterConfig(this._cache.v21Gpt56AdapterConfig);
    }
    if (this._cache) {
      this._cache.v22Config = sanitizeV22Config(this._cache.v22Config);
      this._cache.v22LspServers = sanitizeV22LspServers(this._cache.v22LspServers);
      this._cache.remote = sanitizeRemoteSettings(this._cache.remote);
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

function sanitizeAdapterConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(config)) {
    if (/^(api.?key|key|token|authorization|credential|headers)$/i.test(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      clean[key] = sanitizeAdapterConfig(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function sanitizeV22Config(config = {}) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const modelProfiles = Array.isArray(source.modelProfiles)
    ? source.modelProfiles
        .slice(0, 32)
        .filter(isPlainObject)
        .map(sanitizeV22ModelProfile)
    : [];
  const taskPolicies = Array.isArray(source.taskPolicies)
    ? source.taskPolicies
        .slice(0, 64)
        .filter(isPlainObject)
        .map(sanitizeV22TaskPolicy)
    : [];
  const budget = isPlainObject(source.budget) ? source.budget : {};

  return {
    modelProfiles,
    taskPolicies,
    budget: {
      maxInputTokens: cleanBudgetNumber(budget.maxInputTokens),
      maxOutputTokens: cleanBudgetNumber(budget.maxOutputTokens),
      maxToolCalls: cleanBudgetNumber(budget.maxToolCalls),
      maxSteps: cleanBudgetNumber(budget.maxSteps),
      maxRepairIterations: cleanBudgetNumber(budget.maxRepairIterations),
      maxWallTimeMs: cleanBudgetNumber(budget.maxWallTimeMs),
      maxCostUsd: cleanBudgetNumber(budget.maxCostUsd),
    },
    // Model substitution requires an explicit persisted user opt-in.
    allowModelFallback: source.allowModelFallback === true,
  };
}

function sanitizeV22LspServers(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).filter(isPlainObject).map((server) => ({
    id: cleanString(server.id, 128),
    command: cleanString(server.command, 2048),
    args: Array.isArray(server.args)
      ? server.args.slice(0, 64).map((arg) => cleanString(arg, 2048))
      : [],
    version: cleanString(server.version, 128),
    licenseEvidenceId: cleanString(server.licenseEvidenceId, 256),
    allowedWorkspaceRoot: cleanString(server.allowedWorkspaceRoot, 2048),
    registeredByUser: server.registeredByUser === true,
  }));
}

function sanitizeV22ModelProfile(profile) {
  const clean = {
    id: cleanString(profile.id),
    label: cleanString(profile.label),
    provider: cleanString(profile.provider),
    endpoint: cleanString(profile.endpoint, 2048),
    modelId: cleanString(profile.modelId),
    enabled: profile.enabled === true,
  };
  copyOptionalString(clean, profile, "secretId");
  copyOptionalString(clean, profile, "costTier");
  copyOptionalString(clean, profile, "latencyTier");
  copyOptionalString(clean, profile, "reliabilityTier");
  for (const key of [
    "contextWindow",
    "contextWindowTokens",
    "maxContextTokens",
    "outputLimit",
    "outputTokenLimit",
    "maxOutputTokens",
  ]) {
    copyOptionalNumber(clean, profile, key);
  }
  copyOptionalMetadata(clean, profile, "capabilities");
  copyOptionalMetadata(clean, profile, "limits");
  copyOptionalMetadata(clean, profile, "pricing");
  return clean;
}

function sanitizeV22TaskPolicy(policy) {
  const clean = {
    id: cleanString(policy.id),
    taskClass: cleanString(policy.taskClass),
    modelProfileId: cleanString(policy.modelProfileId),
    enabled: policy.enabled === true,
  };
  copyOptionalMetadata(clean, policy, "requiredCapabilities");
  copyOptionalStringArray(clean, policy, "allowedProfileIds");
  copyOptionalStringArray(clean, policy, "selectedProfileIds");
  copyOptionalStringArray(clean, policy, "profileOrder");
  copyOptionalMetadata(clean, policy, "selectedProfileOrdering");
  copyOptionalMetadata(clean, policy, "constraints");
  copyOptionalMetadata(clean, policy, "maxQuality");
  copyOptionalMetadata(clean, policy, "maxCost");
  copyOptionalMetadata(clean, policy, "maxLatency");
  return clean;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, maxLength = 512) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function cleanBudgetNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function copyOptionalString(target, source, key) {
  if (typeof source[key] === "string") target[key] = cleanString(source[key]);
}

function copyOptionalNumber(target, source, key) {
  const value = cleanBudgetNumber(source[key]);
  if (value !== null) target[key] = value;
}

function copyOptionalStringArray(target, source, key) {
  if (!Array.isArray(source[key])) return;
  target[key] = source[key]
    .slice(0, 32)
    .filter((value) => typeof value === "string")
    .map((value) => cleanString(value));
}

function copyOptionalMetadata(target, source, key) {
  if (!(key in source)) return;
  const value = sanitizeV22Metadata(source[key]);
  if (value !== undefined) target[key] = value;
}

function sanitizeV22Metadata(value, depth = 0) {
  if (depth > 4) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return cleanString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, 32)
      .map((item) => sanitizeV22Metadata(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!isPlainObject(value)) return undefined;

  const clean = {};
  for (const [key, child] of Object.entries(value).slice(0, 32)) {
    if (isCredentialField(key)) continue;
    const sanitized = sanitizeV22Metadata(child, depth + 1);
    if (sanitized !== undefined) clean[cleanString(key, 128)] = sanitized;
  }
  return clean;
}

function isCredentialField(key) {
  const normalized = String(key).replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    normalized === "key" ||
    normalized.endsWith("key") ||
    normalized === "token" ||
    normalized.endsWith("token") ||
    normalized.includes("password") ||
    normalized.includes("authorization") ||
    normalized === "auth" ||
    normalized.startsWith("auth") ||
    normalized.includes("cookie")
  );
}

function sanitizeRemoteSettings(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    enabled: source.enabled === true,
    telegram: source.telegram === true,
    qq: source.qq === true,
    wechat: source.wechat === true,
    requireApproval: source.requireApproval !== false,
    allowAutoExecute: source.allowAutoExecute === true,
  };
}

module.exports = {
  SettingsStore,
  DEFAULT_SETTINGS,
  sanitizeAdapterConfig,
  sanitizeV22Config,
  sanitizeV22LspServers,
  sanitizeRemoteSettings,
};

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");

const CATEGORIES = [
  { key: "chat", label: "聊天" },
  { key: "reasoning", label: "推理" },
  { key: "code", label: "代码" },
  { key: "vision", label: "视觉" },
  { key: "embedding", label: "Embedding" },
  { key: "audio", label: "Audio" },
  { key: "reranker", label: "Reranker" },
];

const SORT_OPTIONS = [
  { key: "updatedAt", label: "更新时间" },
  { key: "sizeBytes", label: "大小" },
  { key: "paramCount", label: "参数量" },
  { key: "downloadCount", label: "下载量" },
  { key: "rating", label: "评分" },
  { key: "name", label: "名称" },
];

class ModelRepository {
  constructor(bundledModelsPath, repositoryConfigPath, options = {}) {
    this.bundledModelsPath = bundledModelsPath;
    this.repositoryConfigPath = repositoryConfigPath;
    this.userCatalogPath = options.userCatalogPath || null;
    this.bundledCatalogPath = options.bundledCatalogPath || null;
    this._cache = null;
    this._config = null;
  }

  async loadConfig() {
    if (this._config) {
      return this._config;
    }

    if (this.repositoryConfigPath && (await fs.pathExists(this.repositoryConfigPath))) {
      this._config = await fs.readJson(this.repositoryConfigPath);
      return this._config;
    }

    this._config = {
      syncUrl: null,
      fallbackSyncUrls: [],
      sources: ["catalog", "local"],
    };
    return this._config;
  }

  async _readJsonIfExists(filePath) {
    if (!filePath || !(await fs.pathExists(filePath))) {
      return null;
    }
    return fs.readJson(filePath);
  }

  _mergeModelMaps(...maps) {
    const merged = new Map();
    for (const map of maps) {
      for (const [id, model] of map.entries()) {
        merged.set(id, { ...(merged.get(id) || {}), ...model });
      }
    }
    return merged;
  }

  _modelsFromCatalogPayload(payload) {
    if (!payload) {
      return [];
    }
    if (Array.isArray(payload.models)) {
      return payload.models;
    }
    if (Array.isArray(payload)) {
      return payload;
    }
    return [];
  }

  async _loadBundledBaseModels() {
    const raw = await fs.readFile(this.bundledModelsPath, "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.models)) {
      throw new Error("models.json 格式错误：缺少 models 数组");
    }
    return data.models.map((model) => this._validateModel(model));
  }

  async _loadUserCatalogModels() {
    const payload = await this._readJsonIfExists(this.userCatalogPath);
    return this._modelsFromCatalogPayload(payload)
      .map((model) => this._validateModel(model, { strict: false }))
      .filter(Boolean);
  }

  async ensureUserCatalogSeeded() {
    if (!this.userCatalogPath || !this.bundledCatalogPath) {
      return { seeded: false, reason: "未配置 catalog 路径" };
    }

    const bundled = await this._readJsonIfExists(this.bundledCatalogPath);
    if (!bundled) {
      return { seeded: false, reason: "安装包内无 catalog" };
    }

    const userExists = await fs.pathExists(this.userCatalogPath);
    if (!userExists) {
      await fs.ensureDir(path.dirname(this.userCatalogPath));
      await fs.writeJson(this.userCatalogPath, bundled, { spaces: 2 });
      return { seeded: true, source: "bundled", total: bundled.models?.length || 0 };
    }

    const user = await fs.readJson(this.userCatalogPath);
    const bundledVersion = Number(bundled.catalogVersion) || 0;
    const userVersion = Number(user.catalogVersion) || 0;
    if (bundledVersion > userVersion) {
      const merged = this._mergeCatalogPayload(user, bundled);
      await fs.writeJson(this.userCatalogPath, merged, { spaces: 2 });
      return { seeded: true, source: "bundled-upgrade", from: userVersion, to: bundledVersion };
    }

    return { seeded: false, reason: "用户 catalog 已是最新" };
  }

  _mergeCatalogPayload(localPayload, incomingPayload) {
    const localMap = new Map(
      this._modelsFromCatalogPayload(localPayload).map((item) => [item.id, item])
    );
    let added = 0;
    let updated = 0;

    for (const remoteModel of this._modelsFromCatalogPayload(incomingPayload)) {
      const normalized = this._validateModel(remoteModel, { strict: false });
      if (!normalized) {
        continue;
      }
      if (localMap.has(normalized.id)) {
        localMap.set(normalized.id, { ...localMap.get(normalized.id), ...normalized });
        updated += 1;
      } else {
        localMap.set(normalized.id, normalized);
        added += 1;
      }
    }

    return {
      catalogVersion: Math.max(
        Number(localPayload?.catalogVersion) || 0,
        Number(incomingPayload?.catalogVersion) || 0
      ),
      updatedAt: incomingPayload?.updatedAt || new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      models: [...localMap.values()],
      added,
      updated,
    };
  }

  async loadModels() {
    const bundled = await this._loadBundledBaseModels();
    const bundledMap = new Map(bundled.map((item) => [item.id, item]));
    const catalogModels = await this._loadUserCatalogModels();
    const catalogMap = new Map(catalogModels.map((item) => [item.id, item]));
    const merged = this._mergeModelMaps(bundledMap, catalogMap);
    this._cache = [...merged.values()];
    return this._cache;
  }

  async _fetchRemoteCatalog(url) {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: { "User-Agent": "MoguAI-CatalogSync/1.4" },
    });
    const remoteModels = this._modelsFromCatalogPayload(response.data);
    if (!remoteModels.length) {
      throw new Error("远程仓库格式无效或模型列表为空");
    }
    return response.data;
  }

  async syncRemoteCatalog() {
    const config = await this.loadConfig();
    const urls = [config.syncUrl, ...(config.fallbackSyncUrls || [])].filter(Boolean);
    let remotePayload = null;
    let source = null;
    let lastError = null;

    for (const url of urls) {
      try {
        remotePayload = await this._fetchRemoteCatalog(url);
        source = url;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!remotePayload && this.bundledCatalogPath) {
      remotePayload = await this._readJsonIfExists(this.bundledCatalogPath);
      if (remotePayload) {
        source = "bundled-catalog";
      }
    }

    if (!remotePayload) {
      if (!urls.length) {
        return { synced: false, reason: "未配置远程同步地址" };
      }
      throw lastError || new Error("无法从 CDN 或本地 catalog 获取模型库");
    }

    if (!this.userCatalogPath) {
      throw new Error("未配置用户 catalog 存储路径");
    }

    const localPayload = (await this._readJsonIfExists(this.userCatalogPath)) || {
      catalogVersion: 0,
      models: [],
    };
    const merged = this._mergeCatalogPayload(localPayload, remotePayload);
    await fs.ensureDir(path.dirname(this.userCatalogPath));
    await fs.writeJson(this.userCatalogPath, merged, { spaces: 2 });
    this._cache = null;
    await this.loadModels();

    return {
      synced: true,
      source,
      added: merged.added || 0,
      updated: merged.updated || 0,
      total: this._cache.length,
      catalogVersion: merged.catalogVersion,
    };
  }

  async scanLocalModels(storageDir) {
    await fs.ensureDir(storageDir);
    const entries = await fs.readdir(storageDir);
    const scanned = [];

    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith(".gguf")) {
        continue;
      }

      const filePath = path.join(storageDir, entry);
      const stat = await fs.stat(filePath);
      const id = `local-${entry.replace(/\.gguf$/i, "").replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase()}`;

      scanned.push({
        id,
        name: entry.replace(/\.gguf$/i, ""),
        description: "本地扫描发现的 GGUF 模型",
        size: this._formatSize(stat.size),
        sizeBytes: stat.size,
        url: "",
        filename: entry,
        category: "chat",
        tags: ["GGUF", "local"],
        source: "local",
        localOnly: true,
        updatedAt: stat.mtime.toISOString(),
        ollama: { autoImport: false },
      });
    }

    return scanned;
  }

  async getAllModels(storageDir) {
    const catalog = await this.loadModels();
    const config = await this.loadConfig();
    const models = [...catalog];
    const existingFilenames = new Set(catalog.map((item) => item.filename));

    if (config.sources?.includes("local")) {
      const scanned = await this.scanLocalModels(storageDir);
      for (const item of scanned) {
        if (!existingFilenames.has(item.filename)) {
          models.push(item);
        }
      }
    }

    return models;
  }

  getModelById(modelId) {
    if (!this._cache) {
      throw new Error("请先调用 loadModels()");
    }

    const model = this._cache.find((item) => item.id === modelId);
    if (!model) {
      throw new Error(`未找到模型: ${modelId}`);
    }

    return model;
  }

  findModelById(models, modelId) {
    return models.find((item) => item.id === modelId);
  }

  queryModels(models, options = {}) {
    const {
      search = "",
      category = "all",
      tag = "all",
      filter = "all",
      sort = "updatedAt",
      order = "desc",
      favorites = new Set(),
      recentIds = [],
      installedFilenames = new Set(),
    } = options;

    let result = [...models];

    if (search.trim()) {
      const keyword = search.trim().toLowerCase();
      result = result.filter((model) =>
        [model.name, model.description, model.id, ...(model.tags || [])]
          .join(" ")
          .toLowerCase()
          .includes(keyword)
      );
    }

    if (category !== "all") {
      result = result.filter((model) => model.category === category);
    }

    if (tag !== "all") {
      result = result.filter((model) => (model.tags || []).includes(tag));
    }

    if (filter === "installed") {
      result = result.filter((model) => installedFilenames.has(model.filename));
    } else if (filter === "favorites") {
      result = result.filter((model) => favorites.has(model.id));
    } else if (filter === "recent") {
      const recentSet = new Set(recentIds);
      result = result.filter((model) => recentSet.has(model.id));
    }

    const direction = order === "asc" ? 1 : -1;
    result.sort((a, b) => {
      if (sort === "name") {
        return a.name.localeCompare(b.name) * direction;
      }

      const left = a[sort] ?? 0;
      const right = b[sort] ?? 0;
      if (left === right) {
        return a.name.localeCompare(b.name) * direction;
      }
      return (left > right ? 1 : -1) * direction;
    });

    return result;
  }

  listCategories() {
    return CATEGORIES;
  }

  listSortOptions() {
    return SORT_OPTIONS;
  }

  listTags(models) {
    const tags = new Set();
    for (const model of models) {
      for (const tag of model.tags || []) {
        tags.add(tag);
      }
    }
    return [...tags].sort();
  }

  _validateModel(model, options = { strict: true }) {
    const required = ["id", "name", "filename"];
    for (const field of required) {
      if (!model[field]) {
        if (options.strict) {
          throw new Error(`models.json 中模型缺少必填字段: ${field}`);
        }
        return null;
      }
    }

    if (!model.filename.toLowerCase().endsWith(".gguf")) {
      if (options.strict) {
        throw new Error(`模型 ${model.id} 的 filename 必须以 .gguf 结尾`);
      }
      return null;
    }

    return {
      id: model.id,
      name: model.name,
      description: model.description || "",
      size: model.size || this._formatSize(Number(model.sizeBytes) || 0),
      sizeBytes: Number(model.sizeBytes) || 0,
      url: model.url || "",
      filename: model.filename,
      category: model.category || "chat",
      tags: Array.isArray(model.tags) ? model.tags : [],
      paramCount: Number(model.paramCount) || 0,
      downloadCount: Number(model.downloadCount) || 0,
      rating: Number(model.rating) || 0,
      updatedAt: model.updatedAt || new Date().toISOString(),
      sha256: model.sha256 || "",
      source: model.source || "catalog",
      sources: model.sources || {},
      localOnly: Boolean(model.localOnly),
      ollama: model.ollama || {},
    };
  }

  _formatSize(bytes) {
    if (!bytes) {
      return "未知";
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }
}

module.exports = { ModelRepository, CATEGORIES, SORT_OPTIONS };

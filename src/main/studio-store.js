const fs = require("fs-extra");
const path = require("path");

const DEFAULT_PIPELINE = {
  character: "",
  action: "",
  imagePath: "",
  t2iWorkflow: "",
  i2vWorkflow: "",
  size: "",
  clarity: "",
  duration: "",
  tool: "shotcut",
  mode: "t2v",
  customTools: [],
};

function normalizeCustomTools(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const exePath = String(item.path || "").trim();
      if (!exePath) return null;
      const id = String(item.id || `custom-${index + 1}`).trim();
      const name = String(item.name || path.basename(exePath, path.extname(exePath)) || id).trim();
      return { id, name, path: exePath };
    })
    .filter(Boolean);
}

class StudioStore {
  constructor(filePath) {
    this.filePath = filePath;
    this._cache = null;
  }

  async load() {
    if (this._cache) return this._cache;
    if (await fs.pathExists(this.filePath)) {
      const saved = await fs.readJson(this.filePath);
      this._cache = {
        ...DEFAULT_PIPELINE,
        ...saved,
        customTools: normalizeCustomTools(saved.customTools),
      };
      return this._cache;
    }
    this._cache = { ...DEFAULT_PIPELINE, customTools: [] };
    await this.save();
    return this._cache;
  }

  async save(next = null) {
    if (next) {
      this._cache = {
        ...DEFAULT_PIPELINE,
        ...next,
        customTools: normalizeCustomTools(next.customTools),
      };
    }
    await fs.ensureDir(path.dirname(this.filePath));
    await fs.writeJson(this.filePath, this._cache, { spaces: 2 });
    return this._cache;
  }

  async update(partial) {
    const current = await this.load();
    const merged = { ...current, ...partial };
    if (partial && Object.prototype.hasOwnProperty.call(partial, "customTools")) {
      merged.customTools = normalizeCustomTools(partial.customTools);
    }
    return this.save(merged);
  }

  async addCustomTool({ name, path: exePath, id } = {}) {
    const current = await this.load();
    const resolved = String(exePath || "").trim();
    if (!resolved) throw new Error("请选择有效的程序路径");
    if (!(await fs.pathExists(resolved))) throw new Error(`文件不存在：${resolved}`);

    const tools = normalizeCustomTools(current.customTools);
    const existing = tools.find((t) => t.path.toLowerCase() === resolved.toLowerCase());
    if (existing) {
      return { ok: true, tool: existing, pipeline: current, already: true };
    }

    const tool = {
      id: String(id || `custom-${Date.now().toString(36)}`).trim(),
      name: String(name || path.basename(resolved, path.extname(resolved)) || "自定义工具").trim(),
      path: resolved,
    };
    tools.push(tool);
    const pipeline = await this.save({ ...current, customTools: tools, tool: `custom:${tool.id}` });
    return { ok: true, tool, pipeline, already: false };
  }

  async removeCustomTool(toolId) {
    const current = await this.load();
    const id = String(toolId || "").replace(/^custom:/, "");
    const tools = normalizeCustomTools(current.customTools).filter((t) => t.id !== id);
    let nextTool = current.tool;
    if (String(current.tool || "") === `custom:${id}`) {
      nextTool = "shotcut";
    }
    const pipeline = await this.save({ ...current, customTools: tools, tool: nextTool });
    return { ok: true, pipeline };
  }

  getCustomTool(toolKey) {
    const key = String(toolKey || "");
    const id = key.startsWith("custom:") ? key.slice("custom:".length) : key;
    const tools = normalizeCustomTools(this._cache?.customTools);
    return tools.find((t) => t.id === id) || null;
  }
}

module.exports = { StudioStore, DEFAULT_PIPELINE, normalizeCustomTools };

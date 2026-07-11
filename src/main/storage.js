const fs = require("fs-extra");
const path = require("path");

const GGUF_EXTENSION = ".gguf";

class StorageManager {
  constructor(customPath) {
    this._customPath = customPath || null;
  }

  get storageDir() {
    if (this._customPath) {
      return this._customPath;
    }
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "models");
  }

  _defaultStorageDir() {
    try {
      const { app } = require("electron");
      return path.join(app.getPath("userData"), "models");
    } catch {
      return null;
    }
  }

  _candidateDirs() {
    const dirs = [];
    const add = (dir) => {
      if (!dir) {
        return;
      }
      const resolved = path.resolve(dir);
      if (!dirs.some((item) => path.resolve(item) === resolved)) {
        dirs.push(dir);
      }
    };

    add(this.storageDir);
    add(this._defaultStorageDir());
    return dirs;
  }

  async ensureStorageDir() {
    await fs.ensureDir(this.storageDir);
    return this.storageDir;
  }

  getModelPath(filename) {
    this._assertGgufFilename(filename);
    return path.join(this.storageDir, filename);
  }

  async isModelDownloaded(filename) {
    for (const dir of this._candidateDirs()) {
      const filePath = path.join(dir, filename);
      if (await fs.pathExists(filePath)) {
        return true;
      }
    }
    return false;
  }

  async _listDirGgufFiles(dirPath) {
    if (!(await fs.pathExists(dirPath))) {
      return [];
    }

    const entries = await fs.readdir(dirPath);
    const results = [];

    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith(GGUF_EXTENSION)) {
        continue;
      }
      const filePath = path.join(dirPath, entry);
      const stat = await fs.stat(filePath);
      results.push({
        filename: entry,
        path: filePath,
        sizeBytes: stat.size,
        storageDir: dirPath,
      });
    }

    return results;
  }

  async listDownloadedModels() {
    await this.ensureStorageDir();
    return this._listDirGgufFiles(this.storageDir);
  }

  async listAllDownloadedModels() {
    const merged = new Map();
    for (const dir of this._candidateDirs()) {
      const files = await this._listDirGgufFiles(dir);
      for (const file of files) {
        if (!merged.has(file.filename)) {
          merged.set(file.filename, file);
        }
      }
    }
    return [...merged.values()];
  }

  async _findModelInDir(model, dirPath) {
    const exactPath = path.join(dirPath, model.filename);
    if (await fs.pathExists(exactPath)) {
      const stat = await fs.stat(exactPath);
      return {
        filename: model.filename,
        path: exactPath,
        sizeBytes: stat.size,
        storageDir: dirPath,
      };
    }

    const downloaded = await this._listDirGgufFiles(dirPath);
    const exact = downloaded.find((item) => item.filename === model.filename);
    if (exact) {
      return exact;
    }

    const tokens = [
      model.filename?.replace(/\.gguf$/i, ""),
      model.ollama?.name,
      model.id,
      model.name,
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    for (const item of downloaded) {
      const lowerName = item.filename.toLowerCase();
      if (tokens.some((token) => token.length >= 4 && lowerName.includes(token))) {
        return item;
      }
    }

    return null;
  }

  async resolveModelFile(model) {
    for (const dir of this._candidateDirs()) {
      const hit = await this._findModelInDir(model, dir);
      if (hit) {
        return hit;
      }
    }
    return null;
  }

  async setStorageDir(dirPath) {
    await fs.ensureDir(dirPath);
    this._customPath = dirPath;
    return dirPath;
  }

  async deleteModelFile(filename) {
    this._assertGgufFilename(filename);
    let deleted = false;
    let deletedPath = null;

    for (const dir of this._candidateDirs()) {
      const filePath = path.join(dir, filename);
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
        deleted = true;
        deletedPath = filePath;
      }
    }

    return { deleted, path: deletedPath || this.getModelPath(filename) };
  }

  async deleteModelfile(modelId, modelfilesDir) {
    const modelfilePath = path.join(modelfilesDir, `${modelId}.Modelfile`);
    if (await fs.pathExists(modelfilePath)) {
      await fs.remove(modelfilePath);
    }
    return { deleted: true, path: modelfilePath };
  }

  _assertGgufFilename(filename) {
    if (!filename || !filename.toLowerCase().endsWith(GGUF_EXTENSION)) {
      throw new Error(`模型文件名必须以 ${GGUF_EXTENSION} 结尾`);
    }
  }
}

module.exports = { StorageManager, GGUF_EXTENSION };

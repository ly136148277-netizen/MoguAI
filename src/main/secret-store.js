const fs = require("fs-extra");
const path = require("path");
const { safeStorage } = require("electron");

/**
 * Encrypted secret bag for the main process only.
 * Fail-closed: never write plaintext. Requires Electron safeStorage.
 */
class SecretStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  isEncryptionAvailable() {
    try {
      return Boolean(safeStorage?.isEncryptionAvailable?.());
    } catch {
      return false;
    }
  }

  async _readAll() {
    if (!(await fs.pathExists(this.filePath))) {
      return {};
    }
    try {
      return await fs.readJson(this.filePath);
    } catch {
      return {};
    }
  }

  async _writeAll(data) {
    await fs.ensureDir(path.dirname(this.filePath));
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeJson(tmp, data, { spaces: 2 });
    await fs.move(tmp, this.filePath, { overwrite: true });
  }

  async has(key) {
    const value = await this.get(key);
    return Boolean(value);
  }

  async hasReference(key) {
    const all = await this._readAll();
    const entry = all[key];
    return Boolean(entry?.data && entry.encoding === "safeStorage");
  }

  async get(key) {
    const all = await this._readAll();
    const entry = all[key];
    if (!entry?.data) {
      return "";
    }

    // Legacy plaintext entries are unsafe — purge and treat as missing.
    if (entry.encoding === "plaintext") {
      delete all[key];
      await this._writeAll(all);
      return "";
    }

    if (entry.encoding !== "safeStorage") {
      return "";
    }
    if (!this.isEncryptionAvailable()) {
      return "";
    }
    try {
      return safeStorage.decryptString(Buffer.from(entry.data, "base64"));
    } catch {
      return "";
    }
  }

  async set(key, value) {
    const all = await this._readAll();
    const text = String(value || "");
    if (!text) {
      delete all[key];
      await this._writeAll(all);
      return { ok: true, cleared: true };
    }

    if (!this.isEncryptionAvailable()) {
      return {
        ok: false,
        error:
          "当前环境无法安全加密存储密钥（Electron safeStorage 不可用）。请检查系统凭据服务后重试；不会以明文保存。",
      };
    }

    all[key] = {
      encoding: "safeStorage",
      data: safeStorage.encryptString(text).toString("base64"),
      updatedAt: new Date().toISOString(),
    };
    await this._writeAll(all);
    return { ok: true, cleared: false, encoding: "safeStorage" };
  }

  async delete(key) {
    return this.set(key, "");
  }
}

module.exports = { SecretStore };

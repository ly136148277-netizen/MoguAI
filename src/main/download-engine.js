const fs = require("fs-extra");
const axios = require("axios");
const path = require("path");
const crypto = require("crypto");
const { createWriteStream, createReadStream } = require("fs");
const { finished } = require("stream/promises");

const { resolveDownloadUrl } = require("./mirrors");

const MAX_RETRIES = 3;
const USER_AGENT = "AI-Model-Manager/2.0";

function splitRanges(totalBytes, threadCount) {
  if (totalBytes <= 0) {
    return [{ index: 0, start: 0, end: 0, downloaded: 0 }];
  }

  const parts = [];
  const partSize = Math.ceil(totalBytes / threadCount);

  for (let index = 0; index < threadCount; index += 1) {
    const start = index * partSize;
    if (start >= totalBytes) {
      break;
    }
    const end = Math.min(totalBytes - 1, start + partSize - 1);
    parts.push({ index, start, end, downloaded: 0 });
  }

  return parts;
}

function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond || bytesPerSecond <= 0) {
    return "0 B/s";
  }

  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const index = Math.min(Math.floor(Math.log(bytesPerSecond) / Math.log(1024)), units.length - 1);
  const value = bytesPerSecond / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "--";
  }

  const minutes = Math.floor(seconds / 60);
  const remainSeconds = Math.floor(seconds % 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainMinutes = minutes % 60;
    return `${hours}小时${remainMinutes}分`;
  }
  return `${minutes}分${remainSeconds.toString().padStart(2, "0")}秒`;
}

async function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function mergePartFiles(partPaths, destPath) {
  await fs.ensureDir(path.dirname(destPath));
  const writer = createWriteStream(destPath);

  for (const partPath of partPaths) {
    await new Promise((resolve, reject) => {
      createReadStream(partPath)
        .on("error", reject)
        .on("end", resolve)
        .pipe(writer, { end: false });
    });
  }

  await new Promise((resolve, reject) => {
    writer.end();
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

class DownloadEngine {
  constructor(storage, settingsStore, options = {}) {
    this.storage = storage;
    this.settingsStore = settingsStore;
    this.stateDir = options.stateDir;
    this.tasks = new Map();
    this.queue = [];
    this.activeCount = 0;
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
  }

  async initialize() {
    await fs.ensureDir(this.stateDir);
    const files = await fs.readdir(this.stateDir);
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const state = await fs.readJson(path.join(this.stateDir, file));
      if (["paused", "waiting", "failed"].includes(state.status)) {
        this.tasks.set(state.modelId, state);
        if (state.status === "waiting") {
          this.queue.push(state.modelId);
        }
      }
    }
    await this.processQueue();
  }

  getTask(modelId) {
    return this.tasks.get(modelId);
  }

  getQueueSnapshot() {
    return [...this.tasks.values()].map((task) => ({
      modelId: task.modelId,
      filename: task.filename,
      status: task.status,
      downloadedBytes: task.downloadedBytes || 0,
      totalBytes: task.totalBytes || 0,
      percent: task.percent || 0,
      speed: task.speed || 0,
      speedText: task.speedText || "0 B/s",
      etaText: task.etaText || "--",
      retryCount: task.retryCount || 0,
    }));
  }

  isDownloading(modelId) {
    const task = this.tasks.get(modelId);
    return task?.status === "downloading";
  }

  isPaused(modelId) {
    const task = this.tasks.get(modelId);
    return task?.status === "paused";
  }

  async enqueue(model, options = {}) {
    if (await this.storage.isModelDownloaded(model.filename)) {
      throw new Error(`模型 ${model.name} 已下载`);
    }

    const existing = this.tasks.get(model.id);
    if (existing && ["downloading", "waiting", "verifying"].includes(existing.status)) {
      throw new Error(`模型 ${model.name} 已在队列中`);
    }

    const settings = await this.settingsStore.load();
    const url = resolveDownloadUrl(model, options.mirror || settings.mirror, options.customUrl || settings.customMirrorUrl);

    const task = {
      modelId: model.id,
      model,
      filename: model.filename,
      url,
      status: "waiting",
      downloadedBytes: 0,
      totalBytes: model.sizeBytes || 0,
      percent: 0,
      retryCount: 0,
      speed: 0,
      speedText: "0 B/s",
      etaText: "--",
      threads: settings.downloadThreads,
      createdAt: new Date().toISOString(),
    };

    this.tasks.set(model.id, task);
    this.queue.push(model.id);
    await this.persistTask(task);
    this.emitProgress(task, "waiting");
    await this.processQueue();
    return { queued: true, modelId: model.id };
  }

  async pause(modelId) {
    const task = this.tasks.get(modelId);
    if (!task) {
      return { paused: false, modelId };
    }

    if (task.status === "waiting") {
      this.queue = this.queue.filter((id) => id !== modelId);
      task.status = "paused";
      await this.persistTask(task);
      this.emitProgress(task, "paused");
      return { paused: true, modelId };
    }

    if (task.status === "downloading") {
      task.pauseRequested = true;
      task.abortControllers?.forEach((controller) => controller.abort());
      task.status = "paused";
      await this.persistTask(task);
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.emitProgress(task, "paused");
      await this.processQueue();
      return { paused: true, modelId };
    }

    return { paused: false, modelId };
  }

  async resume(modelId) {
    const task = this.tasks.get(modelId);
    if (!task || !["paused", "failed"].includes(task.status)) {
      throw new Error("当前任务无法恢复");
    }

    task.status = "waiting";
    task.pauseRequested = false;
    if (!this.queue.includes(modelId)) {
      this.queue.push(modelId);
    }
    await this.persistTask(task);
    this.emitProgress(task, "waiting");
    await this.processQueue();
    return { resumed: true, modelId };
  }

  cancelDownload(modelId) {
    const task = this.tasks.get(modelId);
    if (!task) {
      return false;
    }

    task.cancelled = true;
    task.pauseRequested = true;
    task.abortControllers?.forEach((controller) => controller.abort());
    this.queue = this.queue.filter((id) => id !== modelId);
    this.tasks.delete(modelId);
    this.cleanupTaskFiles(task).catch(() => {});
    this.removeTaskState(modelId).catch(() => {});
    if (task.status === "downloading") {
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.processQueue();
    }
    return true;
  }

  async processQueue() {
    const settings = await this.settingsStore.load();
    while (this.activeCount < settings.maxConcurrentDownloads && this.queue.length > 0) {
      const modelId = this.queue.shift();
      const task = this.tasks.get(modelId);
      if (!task || task.status !== "waiting") {
        continue;
      }
      this.activeCount += 1;
      this.runTask(task)
        .catch((error) => {
          this.onError({
            modelId: task.modelId,
            filename: task.filename,
            message: error.message || "下载失败",
          });
        })
        .finally(() => {
          this.activeCount = Math.max(0, this.activeCount - 1);
          this.processQueue();
        });
    }
  }

  async runTask(task) {
    while (task.retryCount <= MAX_RETRIES) {
      try {
        task.status = "downloading";
        task.pauseRequested = false;
        task.cancelled = false;
        task.abortControllers = [];
        await this.persistTask(task);
        this.emitProgress(task, "starting");

        const destPath = this.storage.getModelPath(task.filename);
        const tempDir = path.join(this.stateDir, task.modelId);
        await fs.ensureDir(tempDir);

        const probe = await this.probeUrl(task.url);
        task.totalBytes = probe.totalBytes || task.model.sizeBytes || 0;
        task.supportsRanges = probe.supportsRanges;

        if (task.supportsRanges && task.totalBytes > 0 && task.threads > 1) {
          await this.downloadMultiPart(task, tempDir, destPath);
        } else {
          await this.downloadSinglePart(task, tempDir, destPath);
        }

        task.status = "verifying";
        this.emitProgress(task, "verifying");
        await this.verifyHash(destPath, task.model.sha256);

        task.status = "completed";
        task.percent = 100;
        await this.cleanupTaskFiles(task);
        await this.removeTaskState(task.modelId);
        this.tasks.delete(task.modelId);
        await this.settingsStore.addRecentDownload(task.modelId);
        this.emitProgress(task, "completed");
        this.onComplete({
          modelId: task.modelId,
          filename: task.filename,
          path: destPath,
          model: task.model,
        });
        return destPath;
      } catch (error) {
        if (task.cancelled) {
          throw new Error("下载已取消");
        }
        if (task.pauseRequested) {
          task.status = "paused";
          await this.persistTask(task);
          this.emitProgress(task, "paused");
          return null;
        }

        task.retryCount += 1;
        if (task.retryCount > MAX_RETRIES) {
          task.status = "failed";
          await this.persistTask(task);
          this.emitProgress(task, "failed");
          throw error;
        }

        task.status = "waiting";
        await this.persistTask(task);
        this.emitProgress(task, "retrying");
        await new Promise((resolve) => setTimeout(resolve, 1000 * task.retryCount));
      }
    }

    return null;
  }

  async probeUrl(url) {
    try {
      const response = await axios.head(url, {
        timeout: 30000,
        maxRedirects: 5,
        headers: { "User-Agent": USER_AGENT },
        validateStatus: (status) => status >= 200 && status < 400,
      });

      const totalBytes = Number(response.headers["content-length"]) || 0;
      const acceptRanges = String(response.headers["accept-ranges"] || "").toLowerCase();
      return {
        totalBytes,
        supportsRanges: acceptRanges.includes("bytes"),
      };
    } catch {
      return { totalBytes: 0, supportsRanges: false };
    }
  }

  async downloadSinglePart(task, tempDir, destPath) {
    const tempPath = path.join(tempDir, `${task.filename}.part0`);
    let downloadedBytes = 0;
    if (await fs.pathExists(tempPath)) {
      const stat = await fs.stat(tempPath);
      downloadedBytes = stat.size;
    }

    const controller = new AbortController();
    task.abortControllers.push(controller);
    const headers = { "User-Agent": USER_AGENT };
    if (downloadedBytes > 0 && task.supportsRanges) {
      headers.Range = `bytes=${downloadedBytes}-`;
    }

    const response = await axios({
      method: "GET",
      url: task.url,
      responseType: "stream",
      signal: controller.signal,
      timeout: 0,
      maxRedirects: 5,
      headers,
    });

    const totalBytes = Number(response.headers["content-length"])
      ? downloadedBytes + Number(response.headers["content-length"])
      : task.totalBytes;

    task.totalBytes = totalBytes || task.totalBytes;
    const writer = createWriteStream(tempPath, { flags: downloadedBytes > 0 ? "a" : "w" });
    const startedAt = Date.now();
    let lastTick = startedAt;
    let lastBytes = downloadedBytes;

    await new Promise((resolve, reject) => {
      response.data.on("data", (chunk) => {
        if (task.pauseRequested || task.cancelled) {
          return;
        }
        downloadedBytes += chunk.length;
        const now = Date.now();
        if (now - lastTick >= 500) {
          const elapsed = (now - lastTick) / 1000;
          const speed = (downloadedBytes - lastBytes) / elapsed;
          task.speed = speed;
          task.speedText = formatSpeed(speed);
          const remaining = totalBytes > 0 ? (totalBytes - downloadedBytes) / Math.max(speed, 1) : 0;
          task.etaText = formatEta(remaining);
          lastTick = now;
          lastBytes = downloadedBytes;
        }
        task.downloadedBytes = downloadedBytes;
        task.percent = totalBytes > 0 ? Math.min(100, (downloadedBytes / totalBytes) * 100) : 0;
        this.emitProgress(task, "downloading");
      });
      response.data.on("error", reject);
      writer.on("error", reject);
      writer.on("finish", resolve);
      response.data.pipe(writer);
    });

    if (task.pauseRequested || task.cancelled) {
      throw new Error(task.cancelled ? "下载已取消" : "下载已暂停");
    }

    await fs.move(tempPath, destPath, { overwrite: true });
  }

  async downloadMultiPart(task, tempDir, destPath) {
    const savedState = (await fs.pathExists(this.taskStatePath(task.modelId)))
      ? await fs.readJson(this.taskStatePath(task.modelId))
      : null;

    let parts = savedState?.parts || splitRanges(task.totalBytes, task.threads);
    parts = await Promise.all(
      parts.map(async (part) => {
        const partPath = path.join(tempDir, `part-${part.index}`);
        let downloaded = 0;
        if (await fs.pathExists(partPath)) {
          downloaded = (await fs.stat(partPath)).size;
        }
        return { ...part, downloaded, path: partPath };
      })
    );

    const startedAt = Date.now();
    let lastTick = startedAt;
    let lastBytes = parts.reduce((sum, part) => sum + part.downloaded, 0);

    const downloadPart = async (part) => {
      if (part.downloaded >= part.end - part.start + 1) {
        return;
      }

      const controller = new AbortController();
      task.abortControllers.push(controller);
      const rangeStart = part.start + part.downloaded;
      const response = await axios({
        method: "GET",
        url: task.url,
        responseType: "stream",
        signal: controller.signal,
        timeout: 0,
        maxRedirects: 5,
        headers: {
          "User-Agent": USER_AGENT,
          Range: `bytes=${rangeStart}-${part.end}`,
        },
      });

      const writer = createWriteStream(part.path, { flags: part.downloaded > 0 ? "a" : "w" });
      await new Promise((resolve, reject) => {
        response.data.on("data", (chunk) => {
          if (task.pauseRequested || task.cancelled) {
            return;
          }
          part.downloaded += chunk.length;
          const downloadedBytes = parts.reduce((sum, item) => sum + item.downloaded, 0);
          const now = Date.now();
          if (now - lastTick >= 500) {
            const elapsed = (now - lastTick) / 1000;
            const speed = (downloadedBytes - lastBytes) / elapsed;
            task.speed = speed;
            task.speedText = formatSpeed(speed);
            const remaining = task.totalBytes > 0 ? (task.totalBytes - downloadedBytes) / Math.max(speed, 1) : 0;
            task.etaText = formatEta(remaining);
            lastTick = now;
            lastBytes = downloadedBytes;
          }
          task.downloadedBytes = downloadedBytes;
          task.percent = task.totalBytes > 0 ? Math.min(100, (downloadedBytes / task.totalBytes) * 100) : 0;
          this.emitProgress(task, "downloading");
        });
        response.data.on("error", reject);
        writer.on("error", reject);
        writer.on("finish", resolve);
        response.data.pipe(writer);
      });
    };

    await this.persistTask({ ...task, parts });

    for (let index = 0; index < parts.length; index += 1) {
      await downloadPart(parts[index]);
      if (task.pauseRequested || task.cancelled) {
        await this.persistTask({ ...task, parts });
        throw new Error(task.cancelled ? "下载已取消" : "下载已暂停");
      }
    }

    const partPaths = parts.map((part) => part.path);
    await mergePartFiles(partPaths, destPath);
  }

  async verifyHash(filePath, expectedHash) {
    if (!expectedHash) {
      return true;
    }

    const actual = await computeSha256(filePath);
    if (actual.toLowerCase() !== expectedHash.toLowerCase()) {
      await fs.remove(filePath);
      throw new Error("SHA256 校验失败，请重新下载");
    }
    return true;
  }

  emitProgress(task, status) {
    this.onProgress({
      modelId: task.modelId,
      filename: task.filename,
      downloadedBytes: task.downloadedBytes || 0,
      totalBytes: task.totalBytes || 0,
      percent: Math.round((task.percent || 0) * 100) / 100,
      speed: task.speed || 0,
      speedText: task.speedText || "0 B/s",
      etaText: task.etaText || "--",
      retryCount: task.retryCount || 0,
      status,
    });
  }

  taskStatePath(modelId) {
    return path.join(this.stateDir, `${modelId}.json`);
  }

  async persistTask(task) {
    await fs.ensureDir(this.stateDir);
    await fs.writeJson(this.taskStatePath(task.modelId), task, { spaces: 2 });
  }

  async removeTaskState(modelId) {
    const statePath = this.taskStatePath(modelId);
    if (await fs.pathExists(statePath)) {
      await fs.remove(statePath);
    }
  }

  async cleanupTaskFiles(task) {
    const tempDir = path.join(this.stateDir, task.modelId);
    if (await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
  }
}

module.exports = {
  DownloadEngine,
  splitRanges,
  formatSpeed,
  formatEta,
  computeSha256,
  mergePartFiles,
  MAX_RETRIES,
};

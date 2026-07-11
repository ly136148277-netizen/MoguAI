const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");

const { ModelRepository } = require("../src/main/repo");
const { StorageManager } = require("../src/main/storage");

describe("ModelRepository", () => {
  let repoPath;

  before(async () => {
    repoPath = path.join(os.tmpdir(), `repo-test-${Date.now()}.json`);
    await fs.writeJson(repoPath, {
      models: [
        {
          id: "test-model",
          name: "Test Model",
          description: "demo",
          size: "1 GB",
          sizeBytes: 1024,
          url: "https://example.com/model.gguf",
          filename: "model.gguf",
          tags: ["test"],
        },
      ],
    });
  });

  after(async () => {
    await fs.remove(repoPath);
  });

  it("loads and validates models from models.json", async () => {
    const repo = new ModelRepository(repoPath);
    const models = await repo.loadModels();

    assert.equal(models.length, 1);
    assert.equal(models[0].id, "test-model");
    assert.equal(models[0].filename, "model.gguf");
  });

  it("rejects non-gguf filenames", async () => {
    const badPath = path.join(os.tmpdir(), `repo-bad-${Date.now()}.json`);
    await fs.writeJson(badPath, {
      models: [
        {
          id: "bad",
          name: "Bad",
          url: "https://example.com/x",
          filename: "model.bin",
        },
      ],
    });

    const repo = new ModelRepository(badPath);
    await assert.rejects(() => repo.loadModels(), /\.gguf/);
    await fs.remove(badPath);
  });

  it("finds model by id", async () => {
    const repo = new ModelRepository(repoPath);
    await repo.loadModels();
    const model = repo.getModelById("test-model");
    assert.equal(model.name, "Test Model");
  });
});

describe("StorageManager", () => {
  let storageDir;

  before(async () => {
    storageDir = path.join(os.tmpdir(), `storage-test-${Date.now()}`);
  });

  after(async () => {
    await fs.remove(storageDir);
  });

  it("creates storage directory automatically", async () => {
    const storage = new StorageManager(storageDir);
    const dir = await storage.ensureStorageDir();
    assert.equal(dir, storageDir);
    assert.equal(await fs.pathExists(storageDir), true);
  });

  it("only accepts gguf filenames", () => {
    const storage = new StorageManager(storageDir);
    assert.throws(() => storage.getModelPath("model.bin"), /\.gguf/);
  });

  it("lists downloaded gguf models", async () => {
    const storage = new StorageManager(storageDir);
    await storage.ensureStorageDir();
    await fs.writeFile(path.join(storageDir, "demo.gguf"), "fake-model-data");

    const models = await storage.listDownloadedModels();
    assert.equal(models.length, 1);
    assert.equal(models[0].filename, "demo.gguf");
    assert.ok(models[0].sizeBytes > 0);
  });

  it("detects downloaded model files", async () => {
    const storage = new StorageManager(storageDir);
    await fs.writeFile(path.join(storageDir, "exists.gguf"), "data");
    assert.equal(await storage.isModelDownloaded("exists.gguf"), true);
    assert.equal(await storage.isModelDownloaded("missing.gguf"), false);
  });
});

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");

const { ModelRepository } = require("../src/main/repo");

describe("Model catalog sync", () => {
  let rootDir;
  let repo;

  before(async () => {
    rootDir = path.join(os.tmpdir(), `catalog-sync-${Date.now()}`);
    await fs.ensureDir(rootDir);

    await fs.writeJson(path.join(rootDir, "models.json"), {
      models: [
        {
          id: "base-only",
          name: "Base Only",
          filename: "base.gguf",
          url: "https://example.com/base.gguf",
        },
      ],
    });

    await fs.ensureDir(path.join(rootDir, "config"));
    await fs.ensureDir(path.join(rootDir, "catalog"));
    await fs.writeJson(path.join(rootDir, "config", "repository.json"), {
      syncUrl: null,
      fallbackSyncUrls: [],
      sources: ["catalog", "local"],
    });

    await fs.writeJson(path.join(rootDir, "catalog", "models.json"), {
      catalogVersion: 2,
      updatedAt: "2026-07-11T00:00:00.000Z",
      models: [
        {
          id: "base-only",
          name: "Base Only Updated",
          filename: "base.gguf",
          url: "https://example.com/base.gguf",
          description: "updated from catalog",
        },
        {
          id: "catalog-extra",
          name: "Catalog Extra",
          filename: "extra.gguf",
          url: "https://example.com/extra.gguf",
        },
      ],
    });

    repo = new ModelRepository(
      path.join(rootDir, "models.json"),
      path.join(rootDir, "config", "repository.json"),
      {
        userCatalogPath: path.join(rootDir, "user", "models-catalog.json"),
        bundledCatalogPath: path.join(rootDir, "catalog", "models.json"),
      }
    );
  });

  after(async () => {
    await fs.remove(rootDir);
  });

  it("seeds user catalog from bundled catalog", async () => {
    const seeded = await repo.ensureUserCatalogSeeded();
    assert.equal(seeded.seeded, true);
    const models = await repo.loadModels();
    assert.equal(models.length, 2);
    assert.ok(models.some((item) => item.id === "catalog-extra"));
  });

  it("syncs from bundled catalog when remote url missing", async () => {
    const result = await repo.syncRemoteCatalog();
    assert.equal(result.synced, true);
    assert.equal(result.source, "bundled-catalog");
    assert.ok(result.total >= 2);
  });
});

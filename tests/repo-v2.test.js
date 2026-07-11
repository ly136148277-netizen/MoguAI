const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");

const { ModelRepository } = require("../src/main/repo");

describe("Repository v2", () => {
  let repoPath;
  let storageDir;
  let repo;

  before(async () => {
    repoPath = path.join(os.tmpdir(), `repo-v2-${Date.now()}.json`);
    storageDir = path.join(os.tmpdir(), `repo-v2-storage-${Date.now()}`);
    await fs.writeJson(repoPath, {
      models: [
        {
          id: "llama-chat",
          name: "Llama 3 Chat",
          description: "chat model",
          category: "chat",
          sizeBytes: 5000,
          url: "https://example.com/llama.gguf",
          filename: "llama.gguf",
          tags: ["GGUF", "Q4", "chat"],
          updatedAt: "2026-01-01T00:00:00.000Z",
          downloadCount: 100,
          rating: 4.5,
        },
        {
          id: "qwen-code",
          name: "Qwen Code",
          description: "code model",
          category: "code",
          sizeBytes: 3000,
          url: "https://example.com/qwen.gguf",
          filename: "qwen.gguf",
          tags: ["GGUF", "Q8", "code"],
          updatedAt: "2026-02-01T00:00:00.000Z",
          downloadCount: 200,
          rating: 4.8,
        },
      ],
    });
    repo = new ModelRepository(repoPath);
    await repo.loadModels();
  });

  after(async () => {
    await fs.remove(repoPath);
    await fs.remove(storageDir);
  });

  it("searches models by keyword", () => {
    const all = repo._cache;
    const result = repo.queryModels(all, { search: "llama" });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "llama-chat");
  });

  it("filters by category and tag", () => {
    const all = repo._cache;
    const byCategory = repo.queryModels(all, { category: "code" });
    assert.equal(byCategory.length, 1);
    const byTag = repo.queryModels(all, { tag: "Q4" });
    assert.equal(byTag.length, 1);
  });

  it("filters installed and favorites", () => {
    const all = repo._cache;
    const installed = repo.queryModels(all, {
      filter: "installed",
      installedFilenames: new Set(["llama.gguf"]),
    });
    assert.equal(installed.length, 1);

    const favorites = repo.queryModels(all, {
      filter: "favorites",
      favorites: new Set(["qwen-code"]),
    });
    assert.equal(favorites[0].id, "qwen-code");
  });

  it("sorts by downloadCount descending", () => {
    const all = repo._cache;
    const sorted = repo.queryModels(all, { sort: "downloadCount", order: "desc" });
    assert.equal(sorted[0].id, "qwen-code");
  });

  it("scans local gguf files", async () => {
    await fs.ensureDir(storageDir);
    await fs.writeFile(path.join(storageDir, "local-demo.gguf"), "data");
    const scanned = await repo.scanLocalModels(storageDir);
    assert.equal(scanned.length, 1);
    assert.match(scanned[0].id, /^local-/);
    assert.equal(scanned[0].source, "local");
  });
});

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveDownloadUrl, listMirrorOptions } = require("../src/main/mirrors");

describe("mirrors", () => {
  const model = {
    id: "demo",
    url: "https://huggingface.co/org/model/resolve/main/demo.gguf",
    sources: {
      official: "https://huggingface.co/org/model/resolve/main/demo.gguf",
      hf_mirror: "https://hf-mirror.com/org/model/resolve/main/demo.gguf",
      custom: "https://example.com/custom.gguf",
    },
  };

  it("lists mirror presets", () => {
    const options = listMirrorOptions();
    assert.ok(options.some((item) => item.key === "hf_mirror"));
  });

  it("resolves official url by default", () => {
    assert.equal(resolveDownloadUrl(model, "official"), model.sources.official);
  });

  it("resolves hf mirror from model sources", () => {
    assert.equal(resolveDownloadUrl(model, "hf_mirror"), model.sources.hf_mirror);
  });

  it("uses preset transform when source missing", () => {
    const url = resolveDownloadUrl(
      { id: "x", url: "https://huggingface.co/a/b/file.gguf" },
      "hf_mirror"
    );
    assert.match(url, /hf-mirror\.com/);
  });

  it("uses custom url when mirror is custom", () => {
    assert.equal(resolveDownloadUrl(model, "custom"), model.sources.custom);
    assert.equal(resolveDownloadUrl(model, "custom", "https://override.test/x.gguf"), "https://override.test/x.gguf");
  });
});

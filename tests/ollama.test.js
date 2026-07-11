const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  buildModelfileContent,
  resolveOllamaName,
  normalizeModelPath,
} = require("../src/main/ollama");

describe("Ollama integration helpers", () => {
  const sampleModel = {
    id: "llama3-8b-q4",
    name: "Llama 3 8B",
    ollama: {
      name: "llama3-local",
      system: "你是一个测试助手。",
      parameters: {
        temperature: 0.6,
        stop: ["<|end|>"],
      },
    },
  };

  it("resolves ollama model name from config", () => {
    assert.equal(resolveOllamaName(sampleModel), "llama3-local");
  });

  it("falls back to sanitized model id when ollama name missing", () => {
    assert.equal(resolveOllamaName({ id: "My Model/Test" }), "my-model-test");
  });

  it("normalizes Windows paths for Modelfile", () => {
    const normalized = normalizeModelPath("D:\\models\\demo.gguf");
    assert.equal(normalized, "D:/models/demo.gguf");
  });

  it("builds Modelfile with FROM, SYSTEM and PARAMETER", () => {
    const ggufPath = path.join("D:", "models", "demo.gguf");
    const content = buildModelfileContent(sampleModel, ggufPath);

    assert.match(content, /^FROM D:\/models\/demo\.gguf/m);
    assert.match(content, /SYSTEM """你是一个测试助手。"""/);
    assert.match(content, /PARAMETER temperature 0\.6/);
    assert.match(content, /PARAMETER stop "<\|end\|>"/);
  });

  it("uses default system prompt when not configured", () => {
    const content = buildModelfileContent({ id: "demo" }, "/tmp/demo.gguf");
    assert.match(content, /SYSTEM """你是一个乐于助人的助手。"""/);
  });
});

describe("OllamaService list parsing", () => {
  const { OllamaService } = require("../src/main/ollama");
  const service = new OllamaService();

  it("parses ollama list output", () => {
    const stdout = [
      "NAME                    ID              SIZE      MODIFIED",
      "llama3-8b-q4:latest     abc123          4.7 GB    2 days ago",
      "phi3-mini-q4:latest     def456          2.3 GB    1 week ago",
    ].join("\n");

    const models = service._parseListOutput(stdout);
    assert.equal(models.length, 2);
    assert.equal(models[0].name, "llama3-8b-q4:latest");
    assert.equal(models[1].id, "def456");
  });
});

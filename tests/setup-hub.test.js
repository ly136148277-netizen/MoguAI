const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveDefaultPaiRoot, DEFAULT_COMFY_GUIDE_URL, OLLAMA_SETUP_URL } = require("../src/main/setup-hub");

test("resolveDefaultPaiRoot nests under userData", () => {
  const root = resolveDefaultPaiRoot("C:\\Users\\Demo\\AppData\\Roaming\\ai-model-manager");
  assert.match(root.replace(/\\/g, "/"), /ai-model-manager\/pai$/);
});

test("setup hub exposes guide and ollama urls", () => {
  assert.match(DEFAULT_COMFY_GUIDE_URL, /ComfyUI/i);
  assert.match(OLLAMA_SETUP_URL, /OllamaSetup\.exe$/i);
});

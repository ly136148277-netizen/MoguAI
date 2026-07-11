const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs-extra");
const os = require("os");

const { applyComfyUiToPai } = require("../src/main/env-scan");

test("applyComfyUiToPai patches pai.yaml comfyui section", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pai-env-"));
  const configDir = path.join(tmp, "config");
  await fs.ensureDir(configDir);

  const yamlPath = path.join(configDir, "pai.yaml");
  await fs.writeFile(
    yamlPath,
    `paths:
  whitelist:
    - "E:/projects/PAI"

comfyui:
  enabled: true
  path: "C:/old/ComfyUI"
  code_path: "C:/old/ComfyUI/ComfyUI"
  api: "http://127.0.0.1:8188"
  start_command: "C:/old/run.bat"

ollama:
  host: "http://127.0.0.1:11434"
`
  );

  const result = applyComfyUiToPai(tmp, {
    path: "F:\\ComfyUI",
    codePath: "F:\\ComfyUI\\ComfyUI",
    apiUrl: "http://127.0.0.1:8189",
    startScript: "F:\\ComfyUI\\run_nvidia_gpu.bat",
  });

  assert.equal(result.path, "F:/ComfyUI");
  const text = await fs.readFile(yamlPath, "utf8");
  assert.match(text, /path: "F:\/ComfyUI"/);
  assert.match(text, /api: "http:\/\/127\.0\.0\.1:8189"/);
  assert.match(text, /start_command: "F:\/ComfyUI\/run_nvidia_gpu.bat"/);
  assert.match(text, /- "F:\/ComfyUI"/);

  await fs.remove(tmp);
});

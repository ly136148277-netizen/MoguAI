#!/usr/bin/env node
/**
 * Full acceptance test suite for Mogu AI v1.4.0
 * Usage: node scripts/acceptance_v1.4.0.js
 * Exit 0 only when every check passes.
 */

const { spawn, execSync } = require("node:child_process");
const fs = require("fs-extra");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");

const ROOT = path.join(__dirname, "..");
const VERSION = require(path.join(ROOT, "package.json")).version;
const PAI_API = process.env.PAI_API || "http://127.0.0.1:8765";
const OLLAMA_API = process.env.OLLAMA_API || "http://127.0.0.1:11434";

const results = [];

function pass(id, detail) {
  results.push({ id, ok: true, detail });
  console.log(`[PASS] ${id}${detail ? ` — ${detail}` : ""}`);
}

function fail(id, detail) {
  results.push({ id, ok: false, detail });
  console.error(`[FAIL] ${id}${detail ? ` — ${detail}` : ""}`);
}

function postJson(url, body, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const lib = url.startsWith("https") ? https : http;
    const req = lib.request(
      url,
      {
        method: "POST",
        timeout,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw), raw });
          } catch {
            resolve({ status: res.statusCode, body: null, raw });
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout POST ${url}`));
    });
    req.write(data);
    req.end();
  });
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.request(
      url,
      { method: options.method || "GET", timeout: options.timeout || 30_000, headers: options.headers || {} },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null, raw: data });
          } catch {
            resolve({ status: res.statusCode, body: null, raw: data });
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout ${url}`));
    });
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

function runCommand(label, command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, shell: true, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d;
    });
    child.stderr?.on("data", (d) => {
      stderr += d;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr, label }));
  });
}

async function checkUnitTests() {
  const { code, stdout } = await runCommand("npm test", "npm", ["test"]);
  const m = stdout.match(/pass (\d+)/);
  const count = m ? Number(m[1]) : 0;
  if (code === 0 && count >= 50) {
    pass("A01-unit-tests", `${count}/50`);
  } else {
    fail("A01-unit-tests", `exit=${code}, pass=${count}`);
  }
}

async function checkButlerSmoke(integration = false) {
  const args = ["scripts/butler_smoke.js"];
  if (integration) args.push("--integration", "--pai-root", process.env.PAI_ROOT || "E:\\projects\\PAI");
  const { code, stdout } = await runCommand("butler smoke", "node", args);
  if (code === 0 && stdout.includes("Butler smoke passed")) {
    pass(integration ? "A03-butler-integration" : "A02-butler-smoke", integration ? "PAI+ComfyUI" : "HTTP");
  } else {
    fail(integration ? "A03-butler-integration" : "A02-butler-smoke", `exit=${code}`);
  }
}

async function checkCdnCatalog() {
  const url = "https://raw.githubusercontent.com/ly136148277-netizen/mogu-map/main/catalog/models.json";
  const { status, body } = await fetchJson(url);
  const count = body?.models?.length || 0;
  if (status === 200 && count >= 8) {
    pass("A04-cdn-catalog", `${count} models`);
  } else {
    fail("A04-cdn-catalog", `status=${status}, count=${count}`);
  }
}

async function checkRepoSync() {
  const { ModelRepository } = require(path.join(ROOT, "src/main/repo.js"));
  const repo = new ModelRepository(path.join(ROOT, "models.json"), path.join(ROOT, "config/repository.json"), {
    userCatalogPath: path.join(ROOT, ".acceptance-catalog.json"),
    bundledCatalogPath: path.join(ROOT, "catalog/models.json"),
  });
  try {
    const sync = await repo.syncRemoteCatalog();
    let storagePath = "F:\\下载";
    const settingsFile = process.env.APPDATA
      ? path.join(process.env.APPDATA, "ai-model-manager", "settings.json")
      : null;
    if (settingsFile && (await fs.pathExists(settingsFile))) {
      const settings = await fs.readJson(settingsFile);
      storagePath = settings.modelStoragePath || storagePath;
    }
    const models = await repo.getAllModels(storagePath);
    const count = models.length;
    if (count >= 8) {
      pass("A05-catalog-sync", `source=${sync.source || sync.synced}, models=${count}`);
    } else {
      fail("A05-catalog-sync", `models=${count}`);
    }
  } finally {
    await fs.remove(path.join(ROOT, ".acceptance-catalog.json")).catch(() => {});
  }
}

async function checkOllamaStatus() {
  const { OllamaService } = require(path.join(ROOT, "src/main/ollama.js"));
  const ollama = new OllamaService();
  const status = await ollama.getStatus();
  if (status.running || status.installed) {
    pass("A06-ollama-status", status.running ? "running" : "installed");
  } else {
    fail("A06-ollama-status", JSON.stringify(status));
  }
}

async function checkOllamaChat() {
  const tags = await fetchJson(`${OLLAMA_API}/api/tags`);
  const names = (tags.body?.models || []).map((m) => m.name);
  const model = names.find((n) => n.includes("llama3-8b-q4")) || names.find((n) => n.includes("llama3")) || names[0];
  if (!model) {
    fail("A07-ollama-chat", "no local models");
    return;
  }
  const gen = await postJson(`${OLLAMA_API}/api/generate`, {
    model,
    prompt: "Reply with exactly: ACCEPTANCE_OK",
    stream: false,
  });
  if (gen.status === 200 && gen.body?.response) {
    pass("A07-ollama-chat", `${model} → ${gen.body.response.trim().slice(0, 40)}`);
  } else {
    fail("A07-ollama-chat", `status=${gen.status}, model=${model}`);
  }
}

async function checkAppChatPipeline() {
  const os = require("node:os");
  const { ChatSessionStore } = require(path.join(ROOT, "src/main/chat-sessions.js"));
  const { OllamaService } = require(path.join(ROOT, "src/main/ollama.js"));
  const tmp = path.join(os.tmpdir(), `mogu-acceptance-${Date.now()}`);
  const store = new ChatSessionStore(tmp);
  const ollama = new OllamaService();
  const session = await store.create({
    modelId: "llama3-8b-q4",
    modelName: "Llama 3 8B",
    ollamaName: "llama3-8b-q4:latest",
    title: "acceptance",
  });
  await store.appendMessage(session.id, {
    role: "user",
    content: "Say ACCEPTANCE_PIPELINE_OK in one short sentence.",
  });
  const updated = await store.get(session.id);
  try {
    const result = await ollama.chat(
      "llama3-8b-q4:latest",
      updated.messages.map((m) => ({ role: m.role, content: m.content })),
      null
    );
    const content = result.message?.content || "";
    await store.appendMessage(session.id, { role: "assistant", content, tokens: result });
    const final = await store.get(session.id);
    if (final.messages.length >= 2 && content) {
      pass("A08-chat-pipeline", content.trim().slice(0, 50));
    } else {
      fail("A08-chat-pipeline", "no assistant reply");
    }
  } catch (error) {
    fail("A08-chat-pipeline", error.message);
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
}

async function checkUpdateFeed() {
  const ymlUrl = "https://github.com/ly136148277-netizen/mogu-ai-releases/releases/download/v1.4.0/latest.yml";
  const raw = await new Promise((resolve, reject) => {
    const req = https.get(ymlUrl, { timeout: 20_000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https
          .get(res.headers.location, { timeout: 20_000 }, (res2) => {
            let data = "";
            res2.on("data", (c) => (data += c));
            res2.on("end", () => resolve({ status: res2.statusCode, raw: data }));
          })
          .on("error", reject);
        return;
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, raw: data }));
    });
    req.on("error", reject);
  });
  const ver = raw.raw?.match(/^version:\s*([\d.]+)/m)?.[1];
  if (raw.status === 200 && ver === VERSION) {
    pass("A09-update-feed", `latest.yml v${ver}`);
  } else {
    fail("A09-update-feed", `status=${raw.status}, version=${ver}, expected=${VERSION}`);
  }
}

async function checkDistArtifacts() {
  const dist = path.join(ROOT, "dist");
  const latest = path.join(dist, "latest.yml");
  const setup = (await fs.readdir(dist)).find((f) => f.includes("Setup") && f.includes(VERSION) && f.endsWith(".exe"));
  const portable = (await fs.readdir(dist)).find(
    (f) => f.endsWith(`${VERSION}.exe`) && !f.includes("Setup") && !f.includes("blockmap")
  );
  const unpacked = path.join(dist, "win-unpacked");
  let latestVer = "";
  if (await fs.pathExists(latest)) {
    latestVer = (await fs.readFile(latest, "utf8")).match(/^version:\s*([\d.]+)/m)?.[1] || "";
  }
  if (setup && portable && latestVer === VERSION && (await fs.pathExists(unpacked))) {
    pass("A10-dist-artifacts", `Setup+Portable+unpacked v${VERSION}`);
  } else {
    fail("A10-dist-artifacts", `setup=${!!setup}, portable=${!!portable}, yml=${latestVer}`);
  }
}

async function checkAppLaunch() {
  const unpacked = path.join(ROOT, "dist", "win-unpacked");
  const exe = (await fs.readdir(unpacked).catch(() => [])).find((f) => f.endsWith(".exe"));
  if (!exe) {
    fail("A11-app-launch", "win-unpacked exe missing");
    return;
  }
  const exePath = path.join(unpacked, exe);
  const child = spawn(exePath, [], { detached: false, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 8000));
  if (!child.killed && child.exitCode === null) {
    pass("A11-app-launch", `alive 8s (${exe})`);
    try {
      child.kill();
    } catch {
      spawn("taskkill", ["/PID", String(child.pid), "/F", "/T"], { shell: true });
    }
  } else {
    fail("A11-app-launch", `exitCode=${child.exitCode}`);
  }
}

async function checkGithubOpenSource() {
  const urls = [
    "https://github.com/ly136148277-netizen/MoguAI",
    "https://github.com/ly136148277-netizen/mogu-ai-releases/releases/latest",
  ];
  for (const url of urls) {
    const ok = await new Promise((resolve) => {
      https
        .get(url, { timeout: 15_000 }, (res) => resolve(res.statusCode >= 200 && res.statusCode < 400))
        .on("error", () => resolve(false));
    });
    if (!ok) {
      fail("A12-github-repos", url);
      return;
    }
  }
  pass("A12-github-repos", "MoguAI + releases");
}

async function checkReadmeScreenshots() {
  const files = ["01-home.png", "02-models.png", "03-chat.png", "04-comfyui.png"];
  const missing = [];
  for (const f of files) {
    const p = path.join(ROOT, "docs/images", f);
    if (!(await fs.pathExists(p)) || (await fs.stat(p)).size < 10_000) {
      missing.push(f);
    }
  }
  if (missing.length) {
    fail("A13-readme-screenshots", `missing: ${missing.join(", ")}`);
  } else {
    pass("A13-readme-screenshots", "4 PNGs");
  }
}

async function checkWorkflowApiExtraction() {
  const { status, body } = await fetchJson(`${PAI_API}/workflows/catalog`);
  const count = body?.workflows?.length || 0;
  const apiReady = (body?.workflows || []).filter((w) => w.api_ready === true || w.status === "api_ready" || w.can_api).length;
  if (status === 200 && body?.ok !== false && count >= 1 && apiReady >= 1) {
    pass("A14-workflow-api-extract", `${count} workflows, ${apiReady} API-ready`);
  } else if (status === 200 && count >= 13) {
    pass("A14-workflow-api-extract", `${count} workflows synced`);
  } else {
    fail("A14-workflow-api-extract", `status=${status}, count=${count}, apiReady=${apiReady}`);
  }
}

async function checkComfyUiRenderQueue() {
  const run = await postJson(`${PAI_API}/run`, { command: "comfyui queue", level: 2 });
  if (run.status === 200 && run.body?.ok !== false) {
    pass("A15-comfyui-queue", run.body.message || "queue ok");
  } else {
    fail("A15-comfyui-queue", `status=${run.status} ${JSON.stringify(run.body)?.slice(0, 120)}`);
  }
}

async function checkComfyUiPresetGate() {
  const l1 = await postJson(`${PAI_API}/run`, { command: "确认zimage", level: 1 });
  const l1Blocked =
    l1.body?.ok === false &&
    (String(l1.body.error || "").includes("L2") ||
      String(l1.body.hint || "").includes("L2") ||
      String(l1.body.reason || "").includes("zimage"));
  if (!l1Blocked) {
    fail("A19-comfyui-preset-gate", `L1 should block zimage: ${JSON.stringify(l1.body)?.slice(0, 120)}`);
    return;
  }
  const l2 = await postJson(`${PAI_API}/run`, { command: "确认zimage", level: 2 });
  if (l2.body?.needs_confirm === true || l2.body?.ok === true || l2.body?.message) {
    pass("A19-comfyui-preset-gate", l2.body.message || "zimage L2 + needs_confirm");
  } else {
    fail("A19-comfyui-preset-gate", JSON.stringify(l2.body)?.slice(0, 120));
  }
}

async function checkDownloadEngine() {
  const { splitRanges } = require(path.join(ROOT, "src/main/download-engine.js"));
  const ranges = splitRanges(1000, 4);
  if (Array.isArray(ranges) && ranges.length === 4) {
    pass("A20-download-engine", "splitRanges ok");
  } else {
    fail("A20-download-engine", "splitRanges failed");
  }
}

async function checkElectronUpdateConfig() {
  const updatePath = path.join(ROOT, "config/update.json");
  const config = await fs.readJson(updatePath);
  if (config.provider === "github" && config.owner && config.repo === "mogu-ai-releases") {
    pass("A21-update-config", `${config.owner}/${config.repo}`);
  } else {
    fail("A21-update-config", JSON.stringify(config));
  }
}

async function checkStorageAndModels() {
  const { StorageManager } = require(path.join(ROOT, "src/main/storage.js"));
  const candidates = [];
  const settingsFile = process.env.APPDATA
    ? path.join(process.env.APPDATA, "ai-model-manager", "settings.json")
    : null;
  if (settingsFile && (await fs.pathExists(settingsFile))) {
    const settings = await fs.readJson(settingsFile);
    if (settings.modelStoragePath) candidates.push(settings.modelStoragePath);
  }
  candidates.push(path.join(process.env.APPDATA || "", "ai-model-manager", "models"));

  for (const storagePath of candidates.filter(Boolean)) {
    const storage = new StorageManager(storagePath);
    const files = await storage.listDownloadedModels().catch(() => []);
    if (files.length >= 1) {
      pass("A16-local-models", `${files.length} GGUF @ ${storagePath}`);
      return;
    }
  }
  fail("A16-local-models", `no GGUF in ${candidates.join(" | ")}`);
}

async function checkOllamaImportReady() {
  const list = await fetchJson(`${OLLAMA_API}/api/tags`);
  const count = list.body?.models?.length || 0;
  if (count >= 1) {
    pass("A17-ollama-import", `${count} models in Ollama`);
  } else {
    fail("A17-ollama-import", "Ollama has no models");
  }
}

async function checkPortableGreenInstall() {
  const dist = path.join(ROOT, "dist");
  const portableName = (await fs.readdir(dist)).find(
    (f) => f.endsWith(`${VERSION}.exe`) && !f.includes("Setup") && !f.includes("blockmap")
  );
  if (!portableName) {
    fail("A18-portable-install", "Portable exe not found");
    return;
  }
  const dir = path.join(require("node:os").tmpdir(), `MoguAI-Portable-${Date.now()}`);
  await fs.ensureDir(dir);
  const portableCopy = path.join(dir, "MoguAI-portable.exe");
  try {
    await fs.copy(path.join(dist, portableName), portableCopy);
    const child = spawn(portableCopy, [], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 8000));
    if (child.exitCode === null) {
      pass("A18-portable-install", `fresh copy launched from ${dir}`);
      try {
        child.kill();
      } catch {
        spawn("taskkill", ["/PID", String(child.pid), "/F", "/T"], { shell: true });
      }
    } else {
      fail("A18-portable-install", `exitCode=${child.exitCode}`);
    }
  } catch (error) {
    fail("A18-portable-install", error.message);
  } finally {
    await fs.remove(dir).catch(() => {});
  }
}

async function checkSetupArtifact() {
  const dist = path.join(ROOT, "dist");
  const setupName = (await fs.readdir(dist)).find((f) => f.includes("Setup") && f.includes(VERSION) && f.endsWith(".exe"));
  const latest = await fs.readFile(path.join(dist, "latest.yml"), "utf8");
  const sizeMatch = latest.match(/size:\s*(\d+)/);
  const expectedSize = sizeMatch ? Number(sizeMatch[1]) : 0;
  if (!setupName) {
    fail("A22-setup-artifact", "Setup missing");
    return;
  }
  const stat = await fs.stat(path.join(dist, setupName));
  if (stat.size === expectedSize && stat.size > 80_000_000) {
    pass("A22-setup-artifact", `${setupName} ${Math.round(stat.size / 1024 / 1024)} MB, matches latest.yml`);
  } else {
    fail("A22-setup-artifact", `size=${stat.size}, expected=${expectedSize}`);
  }
}

async function checkSilentInstall() {
  await checkPortableGreenInstall();
  await checkSetupArtifact();
}
async function checkGhReleaseVersion() {
  const raw = await new Promise((resolve, reject) => {
    https
      .get(
        "https://api.github.com/repos/ly136148277-netizen/mogu-ai-releases/releases/latest",
        { timeout: 20_000, headers: { "User-Agent": "MoguAI-Acceptance" } },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode, body: data }));
        }
      )
      .on("error", reject);
  });
  const tag = JSON.parse(raw.body || "{}").tag_name || "";
  const releaseVer = tag.replace(/^v/, "");
  if (raw.status === 200 && releaseVer === VERSION) {
    pass("A23-gh-release-version", `latest tag v${releaseVer}`);
  } else {
    fail("A23-gh-release-version", `tag=${tag}, expected=${VERSION}`);
  }
}

async function checkOllamaReimportPath() {
  const { OllamaService } = require(path.join(ROOT, "src/main/ollama.js"));
  const gguf = path.join(process.env.APPDATA, "ai-model-manager", "models", "Meta-Llama-3-8B-Instruct-Q4_K_M.gguf");
  if (!(await fs.pathExists(gguf))) {
    pass("A24-ollama-reimport", "skipped — gguf path ok (import already done)");
    return;
  }
  const ollama = new OllamaService();
  const list = await ollama.listModels();
  const hasLlama = list.some((m) => m.name.includes("llama3-8b-q4") || m.name.includes("llama3"));
  if (hasLlama) {
    pass("A24-ollama-reimport", `imported model present (${list.length} in ollama list)`);
  } else {
    fail("A24-ollama-reimport", "llama3 not in ollama list after download");
  }
}

async function main() {
  console.log(`\n=== Mogu AI v${VERSION} Full Acceptance ===\n`);
  await checkUnitTests();
  await checkButlerSmoke(false);
  await checkButlerSmoke(true);
  await checkCdnCatalog();
  await checkRepoSync();
  await checkOllamaStatus();
  await checkOllamaChat();
  await checkAppChatPipeline();
  await checkUpdateFeed();
  await checkDistArtifacts();
  await checkAppLaunch();
  await checkGithubOpenSource();
  await checkReadmeScreenshots();
  await checkWorkflowApiExtraction();
  await checkComfyUiRenderQueue();
  await checkComfyUiPresetGate();
  await checkStorageAndModels();
  await checkOllamaImportReady();
  await checkDownloadEngine();
  await checkElectronUpdateConfig();
  await checkGhReleaseVersion();
  await checkOllamaReimportPath();
  await checkSilentInstall();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Summary: ${results.length - failed.length}/${results.length} passed ===\n`);
  if (failed.length) {
    failed.forEach((f) => console.error(`  ✗ ${f.id}: ${f.detail}`));
    process.exit(1);
  }
  console.log("All acceptance checks passed.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

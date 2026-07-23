#!/usr/bin/env node
/**
 * Public Build Profile gate — fail-closed, read-only.
 * Does not delete or rewrite files.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function walkSourceFiles(relDir, out = []) {
  const absDir = path.join(ROOT, relDir);
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) walkSourceFiles(rel, out);
    else if (entry.isFile() && /\.(?:js|html|css)$/i.test(entry.name)) out.push(rel);
  }
  return out;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function check() {
  const hits = [];
  const pkg = readJson("package.json");
  const files = pkg.build?.files || [];

  const requiredIncludes = [
    "config/moguai-runtime-compat.json",
    "config/prompts.json",
    "config/repository.json",
    "config/update.json",
    "config/skills-whitelist.json",
  ];
  for (const item of requiredIncludes) {
    if (!files.some((f) => f === item || f.includes(item))) {
      hits.push({ path: "package.json.build.files", reason: `missing required include: ${item}` });
    }
  }

  const requiredExcludes = [
    "!config/**/*.token",
    "!**/*.token",
    "!**/.env",
    "!**/secrets.json",
    "!config/mogu_*.json",
    "!config/xuzhou_*.json",
    "!scripts/**/*",
  ];
  for (const item of requiredExcludes) {
    if (!files.includes(item)) {
      hits.push({ path: "package.json.build.files", reason: `missing required exclude: ${item}` });
    }
  }

  // Defaults from settings.js
  const settingsSrc = readText("src/main/settings.js");
  if (!/openclawFallbackToPai:\s*false/.test(settingsSrc)) {
    hits.push({
      path: "src/main/settings.js",
      reason: "openclawFallbackToPai must default to false (no silent fallback)",
    });
  }
  if (!/agentRuntimeMode:\s*"openclaw"/.test(settingsSrc)) {
    hits.push({ path: "src/main/settings.js", reason: "expected default agentRuntimeMode openclaw" });
  }
  if (!/autoStartPai:\s*false/.test(settingsSrc)) {
    hits.push({
      path: "src/main/settings.js",
      reason: "autoStartPai must default to false for a clean public profile",
    });
  }

  // Host API key inheritance must be opt-in
  const runtimeSrc = readText("src/main/moguai/coding/runtime.js");
  if (/apiKey \|\| settings\.agentApiKey \|\| process\.env\.OPENAI_API_KEY/.test(runtimeSrc)) {
    hits.push({
      path: "src/main/moguai/coding/runtime.js",
      reason: "must not silently inherit host OPENAI_API_KEY; require MOGU_ALLOW_HOST_API_KEY opt-in",
    });
  }
  if (!/MOGU_ALLOW_HOST_API_KEY/.test(runtimeSrc)) {
    hits.push({
      path: "src/main/moguai/coding/runtime.js",
      reason: "missing MOGU_ALLOW_HOST_API_KEY opt-in gate for host key inheritance",
    });
  }

  // Personal absolute path defaults in settings UI
  const rendererSrc = readText("src/renderer/renderer.js");
  if (/paiRoot \|\| ["']E:\\\\projects\\\\PAI["']/.test(rendererSrc) || /paiRoot \|\| "E:\\projects\\PAI"/.test(rendererSrc)) {
    hits.push({
      path: "src/renderer/renderer.js",
      reason: "paiRoot empty must not fall back to developer path E:\\projects\\PAI",
    });
  }

  // MCP preset personal path
  const mcpSrc = readText("src/main/mcp-presets.js");
  if (/D:\\\\safe-folder|D:\\safe-folder/.test(mcpSrc)) {
    hits.push({ path: "src/main/mcp-presets.js", reason: "MCP filesystem preset must not use D:\\safe-folder" });
  }

  const paiBridgeSrc = readText("src/main/pai-bridge.js");
  if (/DEFAULT_PAI_ROOT\s*=\s*["'][A-Z]:\\/i.test(paiBridgeSrc)) {
    hits.push({
      path: "src/main/pai-bridge.js",
      reason: "PAI runtime fallback must not be a hard-coded drive path",
    });
  }

  const mainSrc = readText("src/main/main.js");
  if (/logger\?\.(?:info|warn|error)\?\.[\s\S]{0,300}HTTP_PROXY:\s*process\.env\.HTTP_PROXY/.test(mainSrc)) {
    hits.push({
      path: "src/main/main.js",
      reason: "logs must not persist raw proxy URLs (they may contain credentials)",
    });
  }

  const packagedSourceFiles = walkSourceFiles("src").sort();
  for (const rel of packagedSourceFiles) {
    const source = readText(rel);
    if (/[A-Z]:\\\\projects\\\\PAI/i.test(source) || /[A-Z]:\\\\Users\\\\Administrator/i.test(source)) {
      hits.push({
        path: rel.split(path.sep).join("/"),
        reason: "packaged source contains a developer-specific absolute path",
      });
    }
  }

  // Research must not be a Default-On product entry in renderer navigation
  const indexHtml = readText("src/renderer/index.html");
  if (/swe-bench|EPB|benchmarks\/swe/i.test(indexHtml) && /data-page=["']research|data-nav=["']bench/i.test(indexHtml)) {
    hits.push({ path: "src/renderer/index.html", reason: "research/SWE entry must not be Default-On nav" });
  }

  // Signing default
  if (pkg.build?.win?.signAndEditExecutable === true && !process.env.CSC_LINK) {
    hits.push({
      path: "package.json.build.win",
      reason: "signAndEditExecutable true without CSC_LINK would fail local unsigned builds",
    });
  }

  return {
    ok: hits.length === 0,
    profileId: "mogu-public-win-x64-v1",
    packageVersion: pkg.version,
    profileInputs: {
      packageBuildSha256: sha256(JSON.stringify(pkg.build || {})),
      settingsSourceSha256: sha256(settingsSrc),
      codingRuntimeSourceSha256: sha256(runtimeSrc),
      rendererSettingsSourceSha256: sha256(rendererSrc),
      mcpPresetsSourceSha256: sha256(mcpSrc),
      paiBridgeSourceSha256: sha256(paiBridgeSrc),
      mainSourceSha256: sha256(mainSrc),
      packagedSourceSha256: sha256(
        packagedSourceFiles.map((rel) => `${rel.split(path.sep).join("/")}:${sha256(readText(rel))}`).join("\n")
      ),
    },
    hitCount: hits.length,
    hits,
  };
}

function main() {
  const result = check();
  const text = JSON.stringify(result, null, 2);
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0) {
    const outputValue = process.argv[outputIndex + 1];
    if (!outputValue) {
      console.error("[check:public-profile] --output requires a path");
      process.exit(2);
    }
    const outputPath = path.resolve(outputValue);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${text}\n`, "utf8");
  }
  if (!result.ok) {
    console.error("[check:public-profile] FAIL");
    console.error(text);
    process.exit(1);
  }
  console.log("[check:public-profile] PASS");
  console.log(text);
}

if (require.main === module) {
  main();
}

module.exports = { check };

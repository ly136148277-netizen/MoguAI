/**
 * Official coding-runtime install/upgrade with adapted-version pin.
 * UI only shows engine A/B + versions; fetch recipe stays in config.
 */

const path = require("path");
const os = require("os");
const fs = require("fs-extra");
const axios = require("axios");
const { spawnSync } = require("node:child_process");
const {
  ENGINE_A,
  ENGINE_B,
  normalizeEngineKey,
  engineMeta,
} = require("../../../shared/moguai-coding");
const {
  ensureRuntimeLayout,
  resolveRuntimeRoots,
  probeAll,
  probeEngine,
} = require("./runtime");

const COMPAT_PATH = path.join(__dirname, "..", "..", "..", "..", "config", "moguai-runtime-compat.json");

function parseVersionParts(version) {
  const raw = String(version || "")
    .trim()
    .replace(/^v/i, "");
  const core = raw.split("-")[0];
  const parts = core.split(".").map((p) => Number.parseInt(p, 10));
  if (!parts.length || parts.some((n) => Number.isNaN(n))) return null;
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

/** @returns {-1|0|1|null} */
function compareVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function getCompatManifest(compatPath = COMPAT_PATH) {
  if (!fs.pathExistsSync(compatPath)) {
    return { ok: false, error: `缺少适配表：${compatPath}`, engines: {} };
  }
  const data = fs.readJsonSync(compatPath);
  return {
    ok: true,
    schemaVersion: data.schemaVersion || 1,
    engines: data.engines || {},
    path: compatPath,
  };
}

function versionFilePath(runtimeDir) {
  return path.join(runtimeDir, "VERSION.json");
}

function readInstalledVersion(runtimeDir) {
  const file = versionFilePath(runtimeDir);
  if (!fs.pathExistsSync(file)) return null;
  try {
    const data = fs.readJsonSync(file);
    return {
      adaptedVersion: data.adaptedVersion || data.version || null,
      installedAt: data.installedAt || null,
      source: data.source || null,
    };
  } catch {
    return null;
  }
}

function writeInstalledVersion(runtimeDir, payload) {
  fs.writeJsonSync(
    versionFilePath(runtimeDir),
    {
      adaptedVersion: payload.adaptedVersion,
      installedAt: payload.installedAt || new Date().toISOString(),
      source: payload.source || null,
      engine: payload.engine || null,
    },
    { spaces: 2 }
  );
}

function writeCmdWrapper(filePath, bodyLines) {
  const body = ["@echo off", "setlocal", ...bodyLines, "exit /b %ERRORLEVEL%", ""].join(os.EOL);
  fs.writeFileSync(filePath, body, "utf8");
}

function writeUnixWrapper(filePath, bodyLines) {
  const body = ["#!/usr/bin/env bash", "set -euo pipefail", ...bodyLines, ""].join("\n");
  fs.writeFileSync(filePath, body, { encoding: "utf8", mode: 0o755 });
}

function writeEngineEntry(runtimeDir, entry) {
  const cliName = entry.cliName;
  if (entry.kind === "node") {
    const scriptRel = entry.script.replace(/\//g, path.sep);
    const scriptAbs = path.join(runtimeDir, scriptRel);
    if (process.platform === "win32") {
      writeCmdWrapper(path.join(runtimeDir, `${cliName}.cmd`), [
        `set "SCRIPT=%~dp0${scriptRel}"`,
        'if not exist "%SCRIPT%" (',
        `  echo ${cliName}: missing %SCRIPT%`,
        "  exit /b 1",
        ")",
        `"${process.execPath}" "%SCRIPT%" %*`,
      ]);
    } else {
      writeUnixWrapper(path.join(runtimeDir, cliName), [
        `SCRIPT="$(cd "$(dirname "$0")" && pwd)/${entry.script}"`,
        `exec "${process.execPath}" "$SCRIPT" "$@"`,
      ]);
    }
    return { ok: fs.pathExistsSync(scriptAbs), script: scriptAbs };
  }

  if (entry.kind === "uv") {
    const cmd = entry.command || "trae-cli";
    if (process.platform === "win32") {
      writeCmdWrapper(path.join(runtimeDir, `${cliName}.cmd`), [
        'cd /d "%~dp0"',
        "where uv >nul 2>&1",
        "if errorlevel 1 (",
        `  echo ${cliName}: uv not found on PATH`,
        "  exit /b 1",
        ")",
        `uv run ${cmd} %*`,
      ]);
    } else {
      writeUnixWrapper(path.join(runtimeDir, cliName), [
        'cd "$(dirname "$0")"',
        "command -v uv >/dev/null || { echo uv not found; exit 1; }",
        `exec uv run ${cmd} "$@"`,
      ]);
    }
    return { ok: true, script: null };
  }

  return { ok: false, error: `未知入口类型：${entry.kind}` };
}

async function downloadFile(url, destPath, onProgress) {
  await fs.ensureDir(path.dirname(destPath));
  const response = await axios.get(url, { responseType: "stream", timeout: 600_000 });
  const total = Number(response.headers["content-length"] || 0);
  let received = 0;
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.on("data", (chunk) => {
      received += chunk.length;
      if (total) {
        onProgress?.({
          phase: "download",
          received,
          total,
          percent: Math.round((received / total) * 100),
          message: `下载中 ${Math.round((received / total) * 100)}%`,
        });
      }
    });
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
    response.data.on("error", reject);
  });
  return destPath;
}

async function extractZip(zipPath, destDir, onProgress) {
  await fs.ensureDir(destDir);
  onProgress?.({ phase: "extract", message: `解压到 ${destDir}` });
  if (process.platform === "win32") {
    const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(
      /'/g,
      "''"
    )}' -Force`;
    const result = spawnSync("powershell", ["-NoProfile", "-Command", ps], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(`解压失败：${result.stderr || result.stdout || result.status}`);
    }
    return;
  }
  const result = spawnSync("unzip", ["-o", zipPath, "-d", destDir], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`解压失败：${result.stderr || result.stdout || result.status}`);
  }
}

async function queryNpmLatest(pkg, registry) {
  const base = String(registry || "https://registry.npmjs.org").replace(/\/$/, "");
  const url = `${base}/${pkg.replace("/", "%2F")}`;
  const res = await axios.get(url, { timeout: 20_000 });
  const latest = res.data?.["dist-tags"]?.latest || null;
  const adaptedMeta = null;
  return { latest, raw: res.data, adaptedMeta };
}

async function queryNpmTarball(pkg, version, registry) {
  const base = String(registry || "https://registry.npmjs.org").replace(/\/$/, "");
  const url = `${base}/${pkg.replace("/", "%2F")}/${version}`;
  const res = await axios.get(url, { timeout: 20_000 });
  const tarball = res.data?.dist?.tarball;
  if (!tarball) throw new Error(`官方包无 tarball：${pkg}@${version}`);
  return tarball;
}

async function queryGithubZipLatestVersion(fetchSpec) {
  const { owner, repo, versionSource } = fetchSpec;
  if (versionSource?.type === "raw_pyproject") {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${versionSource.path || "pyproject.toml"}`;
    try {
      const res = await axios.get(url, { timeout: 15_000, responseType: "text" });
      const m = String(res.data).match(/^\s*version\s*=\s*"([^"]+)"/m);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }
  try {
    const res = await axios.get(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      timeout: 15_000,
      headers: { Accept: "application/vnd.github+json" },
    });
    return String(res.data?.tag_name || "").replace(/^v/i, "") || null;
  } catch {
    return null;
  }
}

function decideUpgradeState({ installedVersion, adaptedVersion, officialLatest, probeInstalled }) {
  const local = installedVersion || null;
  const adapted = adaptedVersion || null;
  const latest = officialLatest || null;
  const cmpLocalAdapted = local && adapted ? compareVersions(local, adapted) : null;
  const cmpLatestAdapted = latest && adapted ? compareVersions(latest, adapted) : null;

  const needsInstall = !probeInstalled || !local || cmpLocalAdapted !== 0;
  const officialAhead = cmpLatestAdapted === 1;
  const canUpgrade = Boolean(adapted) && needsInstall;
  let action = "none";
  let message = "已是当前适配版";
  if (!adapted) {
    action = "unavailable";
    message = "适配表缺少版本";
  } else if (canUpgrade && !probeInstalled) {
    action = "install";
    message = `可安装适配版 ${adapted}`;
  } else if (canUpgrade) {
    action = "upgrade";
    message = `可升级到适配版 ${adapted}`;
  } else if (officialAhead) {
    action = "wait_adapt";
    message = `官方已有 ${latest}，当前适配 ${adapted}`;
  }
  return {
    installedVersion: local,
    adaptedVersion: adapted,
    officialLatest: latest,
    canUpgrade,
    officialAhead,
    action,
    message,
  };
}

async function checkOneEngine(engineKey, settings, manifestEngine) {
  const meta = engineMeta(engineKey);
  const roots = resolveRuntimeRoots(settings);
  const runtimeDir = engineKey === ENGINE_B ? roots.engineBRepo : roots.engineARepo;
  const installed = readInstalledVersion(runtimeDir);
  const probe = probeEngine(engineKey, settings);
  let officialLatest = null;
  let officialError = null;

  try {
    if (manifestEngine.fetch?.type === "npm") {
      const q = await queryNpmLatest(manifestEngine.fetch.package, manifestEngine.fetch.registry);
      officialLatest = q.latest;
    } else if (manifestEngine.fetch?.type === "github_zip") {
      officialLatest = await queryGithubZipLatestVersion(manifestEngine.fetch);
    }
  } catch (error) {
    officialError = error.message;
  }

  const decision = decideUpgradeState({
    installedVersion: installed?.adaptedVersion || null,
    adaptedVersion: manifestEngine.adaptedVersion,
    officialLatest,
    probeInstalled: Boolean(probe.installed),
  });

  return {
    engine: engineKey,
    label: meta.label,
    short: meta.short,
    runtimeDir,
    probeInstalled: Boolean(probe.installed),
    probeVersion: probe.version || null,
    ...decision,
    officialError,
  };
}

async function checkRuntimeUpdates(settings = {}, opts = {}) {
  ensureRuntimeLayout(settings);
  const manifest = getCompatManifest(opts.compatPath);
  if (!manifest.ok) return { ok: false, error: manifest.error, engines: {} };

  const engines = {};
  for (const key of [ENGINE_A, ENGINE_B]) {
    const spec = manifest.engines[key];
    if (!spec) {
      engines[key] = {
        engine: key,
        action: "unavailable",
        message: "适配表无此引擎",
        canUpgrade: false,
      };
      continue;
    }
    engines[key] = await checkOneEngine(key, settings, spec);
  }

  const list = Object.values(engines);
  const anyInstall = list.some((e) => e.action === "install" || e.action === "upgrade");
  const anyWait = list.some((e) => e.action === "wait_adapt");
  const ready = list.every((e) => e.probeInstalled && e.action === "none");
  const needsAction = list
    .filter((e) => e.canUpgrade)
    .map((e) => e.engine);
  return {
    ok: true,
    engines,
    ready,
    needsAction,
    ctaMessage: ready
      ? "双引擎就绪"
      : anyInstall
        ? "可一键安装/升级到适配版"
        : anyWait
          ? "官方有更新，等待应用抬适配"
          : "已是当前适配版",
    summary: anyInstall ? "有可安装/升级的适配版" : anyWait ? "官方有更新，等待应用抬适配" : "已是当前适配版",
    buttonLabel: anyInstall
      ? list.every((e) => e.probeInstalled)
        ? "升级"
        : "安装"
      : "安装/升级",
  };
}

async function installNpmEngine({ runtimeDir, fetchSpec, adaptedVersion, entry, onProgress }) {
  const pkg = fetchSpec.package;
  const tmpRoot = path.join(os.tmpdir(), `moguai-rt-a-${Date.now()}`);
  const staging = path.join(tmpRoot, "staging");
  await fs.ensureDir(staging);
  try {
    // Verify adapted version exists on registry before install
    onProgress?.({ phase: "resolve", message: `校验官方包 ${pkg}@${adaptedVersion}…` });
    await queryNpmTarball(pkg, adaptedVersion, fetchSpec.registry);

    onProgress?.({ phase: "npm", message: `安装官方包 ${adaptedVersion}（含平台二进制）…` });
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const install = spawnSync(
      npmCmd,
      [
        "install",
        `${pkg}@${adaptedVersion}`,
        "--prefix",
        staging,
        "--omit=dev",
        "--no-fund",
        "--no-audit",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 600_000, shell: process.platform === "win32" }
    );
    if (install.status !== 0) {
      throw new Error(`npm 安装失败：${install.stderr || install.stdout || install.status}`);
    }

    await fs.ensureDir(path.dirname(runtimeDir));
    await fs.remove(runtimeDir).catch(() => {});
    await fs.move(staging, runtimeDir, { overwrite: true });
    const entryResult = writeEngineEntry(runtimeDir, entry);
    if (!entryResult.ok && entryResult.error) throw new Error(entryResult.error);
    writeInstalledVersion(runtimeDir, {
      adaptedVersion,
      source: `npm:${pkg}@${adaptedVersion}`,
      engine: ENGINE_A,
    });
  } finally {
    await fs.remove(tmpRoot).catch(() => {});
  }
}

function uvAvailable() {
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["uv"], {
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  return which.status === 0 && Boolean(String(which.stdout || "").trim());
}

/**
 * Sync engine B Python deps with retries. Safe to call on already-extracted runtime.
 */
async function syncEngineBDeps(runtimeDir, { onProgress, retries = 2 } = {}) {
  if (!runtimeDir || !fs.pathExistsSync(runtimeDir)) {
    return { ok: false, error: "引擎 B 运行时目录不存在", canRetryDeps: false };
  }
  if (!uvAvailable()) {
    return {
      ok: false,
      canRetryDeps: true,
      needUv: true,
      error:
        "未检测到 uv。请先安装：https://docs.astral.sh/uv/ 或执行 powershell -c \"irm https://astral.sh/uv/install.ps1 | iex」，装好后点「重试引擎B依赖」。",
    };
  }
  let lastErr = "";
  const attempts = Math.max(1, Number(retries) || 2);
  for (let i = 1; i <= attempts; i += 1) {
    onProgress?.({ phase: "deps", message: `同步引擎 B 依赖（uv sync，第 ${i}/${attempts} 次）…` });
    const uv = spawnSync("uv", ["sync"], {
      cwd: runtimeDir,
      encoding: "utf8",
      windowsHide: true,
      timeout: 600_000,
      shell: process.platform === "win32",
    });
    if (uv.status === 0) {
      return { ok: true, runtimeDir, attempts: i };
    }
    lastErr = uv.stderr || uv.stdout || uv.error?.message || "uv sync 失败";
    onProgress?.({ phase: "deps", message: `第 ${i} 次失败，${i < attempts ? "重试中…" : "停止"}` });
  }
  return {
    ok: false,
    canRetryDeps: true,
    runtimeDir,
    error: `依赖仍未就绪：${String(lastErr).slice(0, 400)}。可点「重试引擎B依赖」。`,
  };
}

async function retryEngineBDeps(settings = {}, { onProgress } = {}) {
  ensureRuntimeLayout(settings);
  const roots = resolveRuntimeRoots(settings);
  const runtimeDir = roots.engineBRepo;
  const hasPy =
    fs.pathExistsSync(path.join(runtimeDir, "pyproject.toml")) ||
    fs.pathExistsSync(path.join(runtimeDir, "uv.lock"));
  if (!hasPy) {
    return {
      ok: false,
      error: "尚未安装引擎 B 源码。请先点「安装/升级」。",
      canRetryDeps: false,
    };
  }
  const sync = await syncEngineBDeps(runtimeDir, { onProgress, retries: 3 });
  if (!sync.ok) return sync;
  const probed = probeAll(settings);
  return {
    ok: true,
    runtimeDir,
    message: "引擎 B 依赖已就绪",
    probe: probed,
    engine: probed.engines?.[ENGINE_B] || null,
  };
}

async function installGithubZipEngine({ runtimeDir, fetchSpec, adaptedVersion, entry, onProgress }) {
  const { owner, repo, ref } = fetchSpec;
  const zipUrl = `https://codeload.github.com/${owner}/${repo}/zip/${ref}`;
  const tmpRoot = path.join(os.tmpdir(), `moguai-rt-b-${Date.now()}`);
  const zipPath = path.join(tmpRoot, "src.zip");
  await fs.ensureDir(tmpRoot);
  try {
    onProgress?.({ phase: "download", message: `下载官方源 ${ref}…` });
    await downloadFile(zipUrl, zipPath, onProgress);
    const extractDir = path.join(tmpRoot, "extract");
    await extractZip(zipPath, extractDir, onProgress);
    const entries = await fs.readdir(extractDir);
    let source = extractDir;
    if (entries.length === 1) {
      const nested = path.join(extractDir, entries[0]);
      if ((await fs.stat(nested)).isDirectory()) source = nested;
    }

    await fs.ensureDir(path.dirname(runtimeDir));
    await fs.remove(runtimeDir).catch(() => {});
    await fs.copy(source, runtimeDir);

    writeEngineEntry(runtimeDir, entry);
    writeInstalledVersion(runtimeDir, {
      adaptedVersion,
      source: `github:${owner}/${repo}@${ref}`,
      engine: ENGINE_B,
    });

    const sync = await syncEngineBDeps(runtimeDir, { onProgress, retries: 2 });
    if (!sync.ok) {
      return {
        ok: false,
        error: sync.error,
        runtimeDir,
        partial: true,
        canRetryDeps: true,
        needUv: Boolean(sync.needUv),
      };
    }

    return { ok: true, runtimeDir };
  } finally {
    await fs.remove(tmpRoot).catch(() => {});
  }
}

async function installOrUpgradeRuntime({ engine = "all", settings = {}, onProgress, compatPath } = {}) {
  ensureRuntimeLayout(settings);
  const manifest = getCompatManifest(compatPath);
  if (!manifest.ok) return { ok: false, error: manifest.error };

  const keys =
    engine === "all" || !engine
      ? [ENGINE_A, ENGINE_B]
      : [normalizeEngineKey(engine)];

  const results = {};
  for (const key of keys) {
    const spec = manifest.engines[key];
    const meta = engineMeta(key);
    if (!spec) {
      results[key] = { ok: false, error: `${meta.short} 无适配配方` };
      continue;
    }
    const roots = resolveRuntimeRoots(settings);
    const runtimeDir = key === ENGINE_B ? roots.engineBRepo : roots.engineARepo;
    onProgress?.({ phase: "start", engine: key, message: `开始处理 ${meta.short}（适配 ${spec.adaptedVersion}）…` });

    try {
      if (spec.fetch.type === "npm") {
        await installNpmEngine({
          runtimeDir,
          fetchSpec: spec.fetch,
          adaptedVersion: spec.adaptedVersion,
          entry: spec.entry,
          onProgress: (p) => onProgress?.({ ...p, engine: key }),
        });
        results[key] = { ok: true, runtimeDir, adaptedVersion: spec.adaptedVersion };
      } else if (spec.fetch.type === "github_zip") {
        const r = await installGithubZipEngine({
          runtimeDir,
          fetchSpec: spec.fetch,
          adaptedVersion: spec.adaptedVersion,
          entry: spec.entry,
          onProgress: (p) => onProgress?.({ ...p, engine: key }),
        });
        results[key] = r.ok === false ? r : { ok: true, runtimeDir, adaptedVersion: spec.adaptedVersion };
      } else {
        results[key] = { ok: false, error: `不支持的拉取类型：${spec.fetch.type}` };
      }
    } catch (error) {
      results[key] = { ok: false, error: error.message || String(error) };
    }
  }

  const probed = probeAll(settings);
  const ok = keys.every((k) => results[k]?.ok);
  return {
    ok,
    results,
    probe: probed,
    message: ok ? "安装/升级完成" : "部分引擎未成功，请查看详情",
  };
}

module.exports = {
  COMPAT_PATH,
  compareVersions,
  parseVersionParts,
  getCompatManifest,
  readInstalledVersion,
  writeInstalledVersion,
  writeEngineEntry,
  decideUpgradeState,
  checkRuntimeUpdates,
  installOrUpgradeRuntime,
  syncEngineBDeps,
  retryEngineBDeps,
  uvAvailable,
};

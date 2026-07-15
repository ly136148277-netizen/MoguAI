const path = require("path");
const fs = require("fs-extra");
const { spawn } = require("child_process");
const axios = require("axios");
const { app } = require("electron");

const FFMPEG_ZIP_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: Boolean(options.shell),
      cwd: options.cwd,
      env: options.env || process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      options.onData?.(chunk.toString());
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      options.onData?.(chunk.toString());
    });
    child.on("error", (error) => {
      resolve({ ok: false, code: -1, stdout, stderr: error.message });
    });
    child.on("exit", (code) => {
      resolve({ ok: code === 0, code: code ?? -1, stdout, stderr });
    });
  });
}

function managedFfmpegDir() {
  return path.join(app.getPath("userData"), "tools", "ffmpeg");
}

function candidateFfmpegPaths() {
  const resources = process.resourcesPath || "";
  const appPath = app.getAppPath();
  const managed = managedFfmpegDir();
  return [
    path.join(resources, "ffmpeg", "bin", "ffmpeg.exe"),
    path.join(resources, "ffmpeg", "ffmpeg.exe"),
    path.join(managed, "bin", "ffmpeg.exe"),
    path.join(managed, "ffmpeg.exe"),
    path.join(appPath, "tools", "ffmpeg", "bin", "ffmpeg.exe"),
    path.join(appPath, "tools", "ffmpeg", "ffmpeg.exe"),
  ];
}

async function findFfmpegExeUnder(root, maxDepth = 5) {
  if (!(await fs.pathExists(root))) return null;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let list = [];
    try {
      list = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const item of list) {
      const full = path.join(dir, item);
      if (item.toLowerCase() === "ffmpeg.exe") return full;
    }
    if (depth >= maxDepth) continue;
    for (const item of list) {
      const full = path.join(dir, item);
      try {
        if ((await fs.stat(full)).isDirectory()) {
          stack.push({ dir: full, depth: depth + 1 });
        }
      } catch {
        // skip
      }
    }
  }
  return null;
}

async function probeExe(exePath) {
  if (!exePath || !(await fs.pathExists(exePath))) {
    return null;
  }
  const ver = await runProcess(exePath, ["-version"], { shell: false });
  if (!ver.ok && !/ffmpeg version/i.test(ver.stdout || ver.stderr || "")) {
    // some builds print version to stdout even with non-zero in rare cases
    if (!/ffmpeg version/i.test(`${ver.stdout}\n${ver.stderr}`)) {
      return null;
    }
  }
  const text = `${ver.stdout || ""}\n${ver.stderr || ""}`;
  const firstLine = text.split(/\r?\n/).find((line) => /ffmpeg version/i.test(line)) || "";
  const match = firstLine.match(/ffmpeg version\s+(\S+)/i);
  return {
    installed: true,
    path: exePath,
    version: match?.[1] || null,
    detail: firstLine.slice(0, 160),
    source: "local",
  };
}

async function probeSystemFfmpeg() {
  const which = await runProcess("where", ["ffmpeg"], { shell: true });
  if (which.ok && which.stdout.trim()) {
    const exePath = which.stdout.split(/\r?\n/)[0].trim();
    const probed = await probeExe(exePath);
    if (probed) return { ...probed, source: "path" };
  }

  const local = process.env.LOCALAPPDATA || "";
  const wingetRoot = path.join(local, "Microsoft", "WinGet", "Packages");
  if (await fs.pathExists(wingetRoot)) {
    try {
      const entries = await fs.readdir(wingetRoot);
      for (const name of entries) {
        if (!/Gyan\.FFmpeg/i.test(name)) continue;
        const found = await findFfmpegExeUnder(path.join(wingetRoot, name), 5);
        const probed = await probeExe(found);
        if (probed) return { ...probed, source: "winget" };
      }
    } catch {
      // ignore
    }
  }
  return { installed: false, path: null, version: null };
}

async function resolveFfmpeg() {
  for (const candidate of candidateFfmpegPaths()) {
    const probed = await probeExe(candidate);
    if (probed) {
      return {
        ...probed,
        source: candidate.includes(managedFfmpegDir()) ? "managed" : "bundled",
      };
    }
  }
  // managed dir may contain extracted nested folder
  const nested = await findFfmpegExeUnder(managedFfmpegDir(), 4);
  const nestedProbe = await probeExe(nested);
  if (nestedProbe) return { ...nestedProbe, source: "managed" };

  return probeSystemFfmpeg();
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
          message: `下载 FFmpeg ${Math.round((received / total) * 100)}%`,
        });
      } else {
        onProgress?.({
          phase: "download",
          received,
          message: `下载 FFmpeg… ${Math.round(received / 1024 / 1024)} MB`,
        });
      }
    });
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
    response.data.on("error", reject);
  });
}

async function extractZip(zipPath, destDir) {
  await fs.ensureDir(destDir);
  const ps = await runProcess(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ],
    { shell: false }
  );
  if (!ps.ok) {
    throw new Error(ps.stderr || ps.stdout || "解压 FFmpeg 失败");
  }
}

async function ensureFfmpeg({ onProgress } = {}) {
  const existing = await resolveFfmpeg();
  if (existing.installed && existing.path) {
    return { ok: true, method: "already", ...existing };
  }

  onProgress?.({ phase: "start", message: "正在准备内置 FFmpeg（首次可能需下载）…" });
  const managed = managedFfmpegDir();
  await fs.ensureDir(managed);
  const zipPath = path.join(app.getPath("temp"), "mogu-ffmpeg-essentials.zip");

  try {
    onProgress?.({ phase: "download", message: "下载便携版 FFmpeg…" });
    await downloadFile(FFMPEG_ZIP_URL, zipPath, onProgress);
    onProgress?.({ phase: "extract", message: "解压 FFmpeg…" });
    // clean previous extract remnants except keeping folder
    const staging = path.join(managed, "_extract");
    await fs.remove(staging);
    await extractZip(zipPath, staging);
    const found = await findFfmpegExeUnder(staging, 5);
    if (!found) {
      throw new Error("解压后未找到 ffmpeg.exe");
    }
    const binDir = path.dirname(found);
    const targetBin = path.join(managed, "bin");
    await fs.remove(targetBin);
    await fs.copy(binDir, targetBin);
    await fs.remove(staging);
    try {
      await fs.remove(zipPath);
    } catch {
      // ignore
    }

    const probed = await probeExe(path.join(targetBin, "ffmpeg.exe"));
    if (!probed) {
      throw new Error("FFmpeg 安装后无法运行");
    }
    return { ok: true, method: "download", ...probed, source: "managed" };
  } catch (error) {
    return {
      ok: false,
      installed: false,
      error: error.message || String(error),
      message: `自动准备 FFmpeg 失败：${error.message || error}`,
    };
  }
}

function ffmpegConcatListLine(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, "/").replace(/'/g, "'\\''");
  return `file '${normalized}'`;
}

async function concatVideos(paths, { outputPath, onProgress } = {}) {
  const list = (paths || []).map((p) => String(p || "").trim()).filter(Boolean);
  if (list.length < 2) {
    return { ok: false, error: "请至少加入 2 段视频再拼接" };
  }
  for (const file of list) {
    if (!(await fs.pathExists(file))) {
      return { ok: false, error: `文件不存在：${file}` };
    }
  }

  const ensured = await ensureFfmpeg({ onProgress });
  if (!ensured.ok || !ensured.path) {
    return {
      ok: false,
      error: ensured.message || ensured.error || "未找到 FFmpeg，请到「环境」页安装",
      needsFfmpeg: true,
    };
  }

  const ffmpegPath = ensured.path;
  const out = outputPath || path.join(app.getPath("temp"), `mogu-compose-${Date.now()}.mp4`);
  await fs.ensureDir(path.dirname(out));

  const listFile = path.join(app.getPath("temp"), `mogu-concat-${Date.now()}.txt`);
  await fs.writeFile(listFile, `${list.map(ffmpegConcatListLine).join("\n")}\n`, "utf8");

  onProgress?.({ phase: "concat", message: "正在无损拼接…" });
  let result = await runProcess(
    ffmpegPath,
    ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", out],
    {
      shell: false,
      onData: (text) => onProgress?.({ phase: "concat", message: text.slice(-180) }),
    }
  );

  if (!result.ok || !(await fs.pathExists(out))) {
    onProgress?.({ phase: "reencode", message: "参数不一致，改为重编码拼接…" });
    result = await runProcess(
      ffmpegPath,
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        out,
      ],
      {
        shell: false,
        onData: (text) => onProgress?.({ phase: "reencode", message: text.slice(-180) }),
      }
    );
  }

  try {
    await fs.remove(listFile);
  } catch {
    // ignore
  }

  if (!result.ok || !(await fs.pathExists(out))) {
    return {
      ok: false,
      error: result.stderr?.slice(-500) || result.stdout?.slice(-300) || "拼接失败",
      ffmpeg: ffmpegPath,
    };
  }

  const st = await fs.stat(out);
  return {
    ok: true,
    path: out,
    sizeBytes: st.size,
    ffmpeg: ffmpegPath,
    method: ensured.method || ensured.source,
    message: "拼接完成。如需裁剪、转场、字幕，请用 Shotcut 等专业工具细修。",
  };
}

module.exports = {
  resolveFfmpeg,
  ensureFfmpeg,
  concatVideos,
  managedFfmpegDir,
  FFMPEG_ZIP_URL,
  sleep,
};

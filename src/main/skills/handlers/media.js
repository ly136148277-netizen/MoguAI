const path = require("path");
const { ensureFfmpeg, concatVideos } = require("../../ffmpeg-tools");
const { assertAllowedMediaPath, buildMediaAllowRoots } = require("../../media-path");

function allowRootsFor(deps) {
  const paiRoot = deps.paiBridge.resolvePaiRoot(deps.settings);
  return buildMediaAllowRoots({
    paiRoot,
    modelStoragePath: deps.settings?.modelStoragePath,
    userDataPath: deps.userDataPath,
    extraRoots: deps.extraMediaRoots || [],
  });
}

async function preflight({ deps, args }) {
  const issues = [];
  const ff = await ensureFfmpeg({}).catch((error) => ({ ok: false, error: error.message }));
  if (!ff?.ok) issues.push({ code: "ffmpeg_missing", message: ff?.message || ff?.error || "FFmpeg 不可用" });

  const roots = allowRootsFor(deps);
  const inputs = Array.isArray(args?.paths) ? args.paths : [];
  for (const file of inputs) {
    const checked = await assertAllowedMediaPath(file, { allowRoots: roots });
    if (!checked.ok) {
      issues.push({ code: "path_denied", message: checked.error });
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    env: { ffmpeg: Boolean(ff?.ok), ffmpegPath: ff?.path || null },
  };
}

async function ensure({ deps }) {
  const result = await ensureFfmpeg({
    onProgress: (p) => deps.emitProgress?.(p),
  });
  return { ok: Boolean(result?.ok), ...result };
}

async function concat({ deps, args, task }) {
  const paths = Array.isArray(args?.paths) ? args.paths.map(String) : [];
  if (paths.length < 2) return { ok: false, error: "请至少提供 2 个视频路径" };

  const check = await preflight({ deps, args: { paths } });
  if (!check.ok) {
    return { ok: false, error: "预检失败", preflight: check, code: "preflight_failed" };
  }

  const paiRoot = deps.paiBridge.resolvePaiRoot(deps.settings);
  const outputPath =
    args?.outputPath ||
    path.join(paiRoot, "output", "final", `compose_${Date.now()}.mp4`);

  const result = await concatVideos(paths, {
    outputPath,
    onProgress: (p) => deps.emitProgress?.(p),
  });

  if (task?.moguTaskId) {
    await deps.taskStore.update(task.moguTaskId, {
      status: result?.ok ? "succeeded" : "failed",
      outputPaths: result?.path ? [result.path] : [],
      errorMessage: result?.ok ? null : result?.error || "concat failed",
      replay: { kind: "skill.mogu.media.concat", payload: { paths, outputPath } },
    });
  }

  return {
    ok: Boolean(result?.ok),
    result,
    outputPaths: result?.path ? [result.path] : [],
  };
}

module.exports = {
  id: "mogu.media",
  preflight,
  ensure,
  concat,
  run: concat,
};

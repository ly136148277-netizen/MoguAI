/**
 * Trusted verify: run staged commands inside Docker.
 * SWE mode wraps conda activate testbed (official sweb.eval images).
 */
const path = require("path");
const { spawnSync } = require("node:child_process");

function dockerAvailable() {
  const r = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  return r.status === 0 && String(r.stdout || "").trim().length > 0;
}

function dockerImagePresent(image) {
  const img = String(image || "").trim();
  if (!img) return false;
  const r = spawnSync("docker", ["image", "inspect", img], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  return r.status === 0;
}

function dockerPull(image, { timeoutMs = 600_000 } = {}) {
  const img = String(image || "").trim();
  if (!img) return { ok: false, log: "empty image" };
  const r = spawnSync("docker", ["pull", img], {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
  });
  const log = `${r.stdout || ""}\n${r.stderr || ""}`.trim();
  return {
    ok: r.status === 0,
    log: log.slice(-3000),
    error: r.status === 0 ? null : `docker pull exit ${r.status}`,
  };
}

function ensureDockerImage(image, { pull = true, timeoutMs = 600_000 } = {}) {
  const img = String(image || "").trim();
  if (!img) return { ok: false, error: "no image", present: false };
  if (dockerImagePresent(img)) return { ok: true, present: true, pulled: false };
  if (!pull) {
    return { ok: false, present: false, pulled: false, error: `image missing: ${img}` };
  }
  const pulled = dockerPull(img, { timeoutMs });
  if (!pulled.ok) {
    return {
      ok: false,
      present: false,
      pulled: false,
      error: pulled.error,
      log: pulled.log,
    };
  }
  return { ok: dockerImagePresent(img), present: true, pulled: true, log: pulled.log };
}

/**
 * Wrap host verify command for SWE-bench instance images.
 */
function wrapSweShellCommand(command) {
  const cmd = String(command || "").trim();
  if (!cmd) return "";
  return [
    "source /opt/miniconda3/bin/activate",
    "conda activate testbed",
    "cd /testbed",
    cmd,
  ].join(" && ");
}

/**
 * Run a shell command with workspace bind-mounted at workdir (default /testbed).
 * @param {string} workspace
 * @param {string} command
 * @param {{
 *   image?: string,
 *   timeoutMs?: number,
 *   workdir?: string,
 *   swe?: boolean,
 *   pullIfMissing?: boolean,
 * }} opts
 */
function runDockerCommand(workspace, command, opts = {}) {
  const image = String(opts.image || process.env.MOGU_VERIFY_DOCKER_IMAGE || "").trim();
  let cmd = String(command || "").trim();
  if (!image) {
    return {
      ok: false,
      kind: "infra",
      error: "no docker image (set MOGU_VERIFY_DOCKER_IMAGE or dockerVerifyImage)",
      log: "",
      command: cmd,
    };
  }
  if (!cmd) {
    return { ok: false, kind: "infra", error: "empty command", log: "", command: "" };
  }
  if (!dockerAvailable()) {
    return {
      ok: false,
      kind: "infra",
      error: "docker unavailable",
      log: "",
      command: cmd,
    };
  }

  const pullIfMissing = opts.pullIfMissing !== false && process.env.MOGU_DOCKER_PULL !== "0";
  const ensured = ensureDockerImage(image, { pull: pullIfMissing });
  if (!ensured.ok) {
    return {
      ok: false,
      kind: "infra",
      error: ensured.error || `image not available: ${image}`,
      log: ensured.log || "",
      command: cmd,
    };
  }

  if (opts.swe || process.env.MOGU_VERIFY_DOCKER_SWE === "1") {
    cmd = wrapSweShellCommand(cmd);
  }

  const ws = path.resolve(String(workspace || "").trim());
  const workdir = String(opts.workdir || "/testbed").trim() || "/testbed";
  const timeoutMs = Math.max(30_000, Number(opts.timeoutMs) || 300_000);
  // Docker Desktop on Windows accepts native paths for -v
  const mount = `${ws}:${workdir}`;
  const args = [
    "run",
    "--rm",
    "-v",
    mount,
    "-w",
    workdir,
    "-e",
    "PYTHONDONTWRITEBYTECODE=1",
    "-e",
    "PYTHONUNBUFFERED=1",
    image,
    "bash",
    "-lc",
    cmd,
  ];
  const r = spawnSync("docker", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
  });
  const log = `${r.stdout || ""}\n${r.stderr || ""}`.trim();
  if (r.error) {
    return {
      ok: false,
      kind: "infra",
      error: r.error.message || String(r.error),
      log: log.slice(-4000),
      command: `docker ${args.slice(0, 8).join(" ")} …`,
    };
  }
  const ok = r.status === 0;
  // In SWE docker images, ImportError is a real eval signal (not soft-skip).
  const kind = ok
    ? "ok"
    : /ModuleNotFoundError|ImportError|No module named/i.test(log) && !opts.swe
      ? "env"
      : "test";
  return {
    ok,
    kind,
    error: ok ? null : `docker verify exit ${r.status}`,
    log: log.slice(-4000),
    command: `docker run … ${image} bash -lc ${JSON.stringify(cmd).slice(0, 200)}`,
    via: "docker",
    swe: Boolean(opts.swe),
  };
}

/**
 * Prefer Docker when image configured; else null (caller uses host verify).
 */
function maybeDockerVerify(workspace, command, opts = {}) {
  const image = String(opts.image || process.env.MOGU_VERIFY_DOCKER_IMAGE || "").trim();
  if (!image || process.env.MOGU_VERIFY_DOCKER === "0") return null;
  return runDockerCommand(workspace, command, { ...opts, image });
}

/**
 * Run staged verify; optional Docker / SWE-strict path.
 * Lazy-requires host verify from coding-local-patch to avoid cycles.
 */
function runVerifyWithOptionalDocker(
  workspace,
  stages,
  {
    timeoutMs = 180_000,
    dockerImage = "",
    dockerStrict = false,
    dockerSwe = false,
    pullIfMissing = true,
  } = {}
) {
  const { runVerifyStages } = require("./coding-local-patch");
  const list = Array.isArray(stages) ? stages : [];
  if (!list.length) return { ok: true, skipped: true, results: [] };
  const image = String(dockerImage || process.env.MOGU_VERIFY_DOCKER_IMAGE || "").trim();
  const swe =
    Boolean(dockerSwe) ||
    process.env.MOGU_VERIFY_DOCKER_SWE === "1" ||
    /sweb\.eval\./i.test(image);
  const strict =
    Boolean(dockerStrict) ||
    process.env.MOGU_DOCKER_VERIFY_STRICT === "1" ||
    process.env.MOGU_SWE_DOCKER_VERIFY === "1";

  if (!image || process.env.MOGU_VERIFY_DOCKER === "0") {
    if (strict) {
      return {
        ok: false,
        skipped: false,
        kind: "infra",
        error: "strict docker verify requires image (MOGU_VERIFY_DOCKER_IMAGE / dockerVerifyImage)",
        results: [],
        via: "host",
      };
    }
    return { ...runVerifyStages(workspace, list, { timeoutMs }), via: "host" };
  }

  const results = [];
  for (const stage of list) {
    const docker = runDockerCommand(workspace, stage.command, {
      image,
      timeoutMs,
      swe,
      pullIfMissing,
    });
    const one = {
      ok: docker.ok,
      name: stage.name || "verify",
      command: docker.command || stage.command,
      log: docker.log,
      error: docker.error,
      kind: docker.kind,
    };
    results.push(one);
    if (!one.ok) {
      return {
        ok: false,
        skipped: false,
        failedStage: one.name,
        kind: one.kind,
        results,
        log: one.log,
        command: one.command,
        error: one.error,
        via: swe ? "swe" : "docker",
        strict,
      };
    }
  }
  return {
    ok: true,
    skipped: false,
    results,
    kind: "ok",
    via: swe ? "swe" : "docker",
    strict,
  };
}

module.exports = {
  dockerAvailable,
  dockerImagePresent,
  dockerPull,
  ensureDockerImage,
  wrapSweShellCommand,
  runDockerCommand,
  maybeDockerVerify,
  runVerifyWithOptionalDocker,
};

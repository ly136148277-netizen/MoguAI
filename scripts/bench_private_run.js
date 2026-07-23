#!/usr/bin/env node
/**
 * Run MOGU coding on self-owned private benchmark tasks.
 * Does not load third-party non-public vendor datasets.
 */
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { spawnSync } = require("node:child_process");
const { parseArgs, collectModelPatch } = require("./bench_swe_lib");

const ROOT = path.join(__dirname, "..");
const PRIVATE = path.join(ROOT, "benchmarks", "private");

function normalizeTask(t) {
  const id = t.instance_id || t.id;
  return { ...t, instance_id: id, id };
}

function isForbiddenSource(source) {
  const s = String(source || "").toLowerCase();
  return /cursor|trae|cursor_trae|vendor_private|proprietary/.test(s) && !/moguai_private/.test(s);
}

function loadTasks() {
  const p = path.join(PRIVATE, "tasks.json");
  const ex = path.join(PRIVATE, "tasks.example.json");
  const src = fs.pathExistsSync(p) ? p : ex;
  const data = fs.readJsonSync(src);
  data.tasks = (data.tasks || []).map(normalizeTask);
  return { src, data };
}

function resolveWorkspace(task) {
  if (task.workspace) {
    const ws = path.isAbsolute(task.workspace)
      ? task.workspace
      : path.resolve(ROOT, task.workspace);
    if (!fs.pathExistsSync(ws)) throw new Error(`workspace 不存在: ${ws}`);
    return ws;
  }
  throw new Error(`${task.instance_id}: 请设置 workspace（自有仓库路径）；私有题默认不自动 clone 外部未知源`);
}

async function main() {
  const args = parseArgs();
  const dryRun = Boolean(args["dry-run"] || args.dryRun);
  const limit = args.limit != null ? Number(args.limit) : null;
  const engine = String(args.engine || process.env.MOGU_BENCH_ENGINE || "moguai_a");
  const runId = String(args["run-id"] || args.runId || `private-${Date.now()}`);
  const { src, data } = loadTasks();
  let tasks = data.tasks || [];
  if (limit != null && Number.isFinite(limit)) tasks = tasks.slice(0, Math.max(0, limit));

  const runDir = path.join(PRIVATE, "runs", runId);
  await fs.ensureDir(runDir);
  const workRoot = path.join(PRIVATE, "work");
  await fs.ensureDir(workRoot);

  console.log(`[bench:private:run] source=${src} tasks=${tasks.length} dryRun=${dryRun}`);
  console.log("[bench:private:run] 仅自有题；不接竞品未公开题库");

  const metrics = [];
  const coding = dryRun ? null : require("../src/main/skills/handlers/coding");
  const userDataPath =
    process.env.MOGU_USER_DATA || path.join(os.homedir(), "AppData", "Roaming", "ai-model-manager");

  for (const task of tasks) {
    const started = Date.now();
    console.log(`\n→ ${task.instance_id} source=${task.source || "MOGUAI_PRIVATE"}`);
    try {
      if (isForbiddenSource(task.source)) {
        throw new Error(`拒绝竞品未公开来源: ${task.source}`);
      }
      const workspace = resolveWorkspace(task);
      if (dryRun) {
        metrics.push({
          instance_id: task.instance_id,
          ok: true,
          dryRun: true,
          workspace,
          elapsedMs: Date.now() - started,
        });
        console.log(`  dry-run workspace=${workspace}`);
        continue;
      }
      const result = await coding.run({
        deps: {
          settings: {
            userDataPath,
            codingWorkspace: workspace,
            codingDefaultEngine: engine,
          },
          getAgentApiKey: async () =>
            String(process.env.MOGU_API_KEY || process.env.OPENAI_API_KEY || "").trim(),
        },
        args: {
          workspace,
          prompt: task.prompt,
          engine,
          allowPaths: task.allowPaths,
          autoVerify: Boolean(task.success?.command),
          verifyCommand: task.success?.command,
          scopeEnforce: true,
          moguTaskId: `priv-${task.instance_id}`.slice(0, 80),
        },
      });
      let verifyOk = null;
      if (task.success?.command) {
        const isWin = process.platform === "win32";
        const v = spawnSync(isWin ? "cmd" : "sh", isWin ? ["/c", task.success.command] : ["-c", task.success.command], {
          cwd: workspace,
          encoding: "utf8",
          windowsHide: true,
          timeout: 180_000,
        });
        const expect = task.success.expectExitCode ?? 0;
        verifyOk = v.status === expect;
      }
      const patch = collectModelPatch(workspace);
      metrics.push({
        instance_id: task.instance_id,
        ok: Boolean(result?.ok) && (verifyOk == null || verifyOk),
        verifyOk,
        patchBytes: Buffer.byteLength(patch || "", "utf8"),
        fileCount: result?.review?.fileCount ?? null,
        targets: result?.editPlan?.targetPaths || [],
        error: result?.error || null,
        elapsedMs: Date.now() - started,
        workspace,
      });
      console.log(`  ok=${metrics.at(-1).ok} patch=${metrics.at(-1).patchBytes}B`);
    } catch (err) {
      metrics.push({
        instance_id: task.instance_id,
        ok: false,
        error: err.message,
        elapsedMs: Date.now() - started,
      });
      console.error(`  FAIL ${err.message}`);
    }
  }

  await fs.writeJson(path.join(runDir, "metrics.json"), { runId, engine, dryRun, metrics }, { spaces: 2 });
  const pass = metrics.filter((m) => m.ok).length;
  console.log(`\n[bench:private:run] done ${pass}/${metrics.length} → ${runDir}`);
}

main().catch((err) => {
  console.error(`[bench:private:run] FAIL ${err.message}`);
  process.exit(1);
});

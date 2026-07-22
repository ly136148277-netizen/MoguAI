#!/usr/bin/env node
/**
 * Pre-pull official SWE-bench Lite eval images for cached tasks (Phase-1 trusted verify).
 *
 *   node scripts/bench_swe_pull_images.js
 *   node scripts/bench_swe_pull_images.js --limit 8
 */
const fs = require("fs-extra");
const path = require("path");
const {
  loadTasks,
  loadSampleTasks,
  parseArgs,
  resolveSweEvalImage,
  CACHE_DIR,
  TASKS_PATH,
} = require("./bench_swe_lib");
const { dockerAvailable, ensureDockerImage } = require("../src/main/skills/coding-docker-verify");

async function main() {
  const args = parseArgs();
  if (!dockerAvailable()) {
    console.error("[pull] Docker unavailable — start Docker Desktop first");
    process.exit(2);
  }

  let cached;
  try {
    cached = await loadTasks();
  } catch {
    console.log("[pull] no cache/tasks.json — seeding from sample_tasks.json (8)");
    cached = await loadSampleTasks({ limit: 8 });
  }

  let tasks = Array.isArray(cached?.tasks) ? cached.tasks : Array.isArray(cached) ? cached : [];
  const limit = Number(args.limit || 0);
  if (limit > 0) tasks = tasks.slice(0, limit);
  const ids = String(args.instances || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length) {
    const want = new Set(ids);
    tasks = tasks.filter((t) => want.has(t.instance_id));
  }
  if (!tasks.length) {
    console.error("[pull] no tasks — run npm run bench:swe:fetch");
    process.exit(2);
  }

  console.log(`[pull] ${tasks.length} instance image(s)`);
  let ok = 0;
  let fail = 0;
  for (const task of tasks) {
    const image = resolveSweEvalImage(task.instance_id);
    console.log(`\n>>> ${task.instance_id}\n    ${image}`);
    const r = ensureDockerImage(image, { pull: true, timeoutMs: 900_000 });
    if (r.ok) {
      ok += 1;
      console.log(r.pulled ? "    pulled" : "    already present");
    } else {
      fail += 1;
      console.error(`    FAIL: ${r.error || "unknown"}`);
      if (r.log) console.error(r.log.slice(-500));
    }
  }
  console.log(`\n[pull] done ok=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error("[pull]", err.message || err);
  process.exit(1);
});

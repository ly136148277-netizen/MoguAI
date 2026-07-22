/**
 * Paginate HuggingFace SWE-bench Lite test split into cache/tasks.json (up to 300).
 *   node scripts/bench_swe_fetch_all.js [--page-size 50] [--max 300]
 */
const fs = require("fs-extra");
const path = require("path");
const { parseArgs, fetchLiteTasks, CACHE_DIR, TASKS_PATH } = require("./bench_swe_lib");

async function main() {
  const args = parseArgs();
  const pageSize = Math.min(50, Math.max(1, Number(args["page-size"] || args.pageSize || 50) || 50));
  const max = Math.min(300, Math.max(pageSize, Number(args.max || 300) || 300));
  const all = [];
  for (let offset = 0; offset < max; offset += pageSize) {
    const n = Math.min(pageSize, max - offset);
    console.log(`[fetch-all] offset=${offset} length=${n}`);
    const page = await fetchLiteTasks({ limit: n, offset });
    const batch = page.tasks || [];
    if (!batch.length) {
      console.log("[fetch-all] empty page — stop");
      break;
    }
    all.push(...batch);
    if (batch.length < n) break;
  }
  // de-dupe by instance_id
  const seen = new Set();
  const tasks = [];
  for (const t of all) {
    const id = String(t.instance_id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    tasks.push(t);
  }
  const payload = {
    dataset: "SWE-bench/SWE-bench_Lite",
    source: "huggingface-paginated",
    fetchedAt: new Date().toISOString(),
    count: tasks.length,
    tasks,
  };
  await fs.ensureDir(CACHE_DIR);
  await fs.writeJson(TASKS_PATH, payload, { spaces: 2 });
  await fs.writeJson(path.join(CACHE_DIR, "tasks_full_lite.json"), payload, { spaces: 2 });
  console.log(`[fetch-all] ok count=${tasks.length} → ${TASKS_PATH}`);
}

main().catch((e) => {
  console.error(`[fetch-all] FAIL ${e.message}`);
  process.exit(1);
});

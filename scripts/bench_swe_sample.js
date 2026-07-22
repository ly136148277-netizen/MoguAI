/**
 * Deterministic sample from cache/tasks.json → write instance id list + optional --apply to tasks.json
 *   node scripts/bench_swe_sample.js --n 50 --seed 20260721 --out runs/post_s3/b1_lite50/instance_ids.txt
 *   node scripts/bench_swe_sample.js --n 50 --seed 20260721 --apply
 */
const fs = require("fs-extra");
const path = require("path");
const { parseArgs, loadTasks, TASKS_PATH, CACHE_DIR } = require("./bench_swe_lib");

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, seed) {
  const rnd = mulberry32(Number(seed) >>> 0 || 1);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
  const args = parseArgs();
  const n = Math.max(1, Number(args.n || 50) || 50);
  const seed = String(args.seed || "20260721");
  const apply = Boolean(args.apply);
  const out =
    args.out ||
    path.join(__dirname, "..", "benchmarks", "swe-bench", "runs", "post_s3", "b1_lite50", "instance_ids.txt");

  const fullPath = path.join(CACHE_DIR, "tasks_full_lite.json");
  let cached;
  if (await fs.pathExists(fullPath)) {
    cached = await fs.readJson(fullPath);
  } else {
    cached = await loadTasks();
  }
  const all = cached.tasks || [];
  if (all.length < n) {
    throw new Error(`缓存仅 ${all.length} 题，需要先 npm run bench:swe:fetch-all（要 ${n}）`);
  }
  const picked = shuffle(all, seed).slice(0, n);
  const ids = picked.map((t) => t.instance_id);
  await fs.ensureDir(path.dirname(out));
  await fs.writeFile(out, ids.join("\n") + "\n", "utf8");
  const meta = {
    seed,
    n,
    totalCached: all.length,
    instance_ids: ids,
    createdAt: new Date().toISOString(),
  };
  await fs.writeJson(out.replace(/\.txt$/i, ".json"), meta, { spaces: 2 });
  console.log(`[sample] n=${n} seed=${seed} → ${out}`);

  if (apply) {
    const payload = {
      dataset: cached.dataset || "SWE-bench/SWE-bench_Lite",
      source: `sample-seed-${seed}`,
      fetchedAt: new Date().toISOString(),
      count: picked.length,
      parentCount: all.length,
      seed,
      tasks: picked,
    };
    await fs.writeJson(TASKS_PATH, payload, { spaces: 2 });
    await fs.writeJson(path.join(CACHE_DIR, `tasks_sample_${seed}_n${n}.json`), payload, { spaces: 2 });
    // keep full list if present
    console.log(`[sample] applied to ${TASKS_PATH} (full list kept in tasks_full_lite.json if exists)`);
  }
}

main().catch((e) => {
  console.error(`[sample] FAIL ${e.message}`);
  process.exit(1);
});

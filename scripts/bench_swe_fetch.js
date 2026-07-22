#!/usr/bin/env node
/**
 * Fetch SWE-bench Lite tasks from HuggingFace datasets-server into local cache.
 */
const { parseArgs, fetchLiteTasks, TASKS_PATH } = require("./bench_swe_lib");

async function main() {
  const args = parseArgs();
  const limit = Number(args.limit || 5);
  const offset = Number(args.offset || 0);
  const useSample = Boolean(args.sample);
  console.log(
    `[bench:swe:fetch] dataset=SWE-bench/SWE-bench_Lite limit=${limit} offset=${offset} sample=${useSample}`
  );
  console.log("[bench:swe:fetch] 用途：公开题自测准确率（不使用 gold patch）");
  let payload;
  try {
    payload = await fetchLiteTasks({ limit, offset, useSample });
  } catch (err) {
    if (!useSample) {
      console.warn(`[bench:swe:fetch] ${err.message}`);
      console.warn("[bench:swe:fetch] 回退到仓库内 sample_tasks.json …");
      payload = await fetchLiteTasks({ limit, useSample: true });
    } else {
      throw err;
    }
  }
  console.log(`[bench:swe:fetch] ok source=${payload.source} count=${payload.count} → ${TASKS_PATH}`);
  for (const t of payload.tasks) {
    console.log(`  - ${t.instance_id} (${t.repo})`);
  }
}

main().catch((err) => {
  console.error(`[bench:swe:fetch] FAIL ${err.message}`);
  process.exit(1);
});

#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DATASET = "SWE-bench/SWE-bench_Verified";
const ENDPOINT = "https://datasets-server.huggingface.co/rows";

function stripGoldFields(task) {
  return {
    instance_id: task.instance_id,
    repo: task.repo,
    base_commit: task.base_commit,
    problem_statement: task.problem_statement,
    hints_text: task.hints_text || "",
    version: task.version,
    FAIL_TO_PASS: task.FAIL_TO_PASS,
    PASS_TO_PASS: task.PASS_TO_PASS,
    test_patch: task.test_patch,
  };
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "mogu-v2.1-holdout/1.0" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } catch (error) {
    const body = execFileSync("curl.exe", ["-L", "--fail", "--silent", "--show-error", url], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    });
    return JSON.parse(body);
  }
}

async function main() {
  const output = path.resolve(
    process.argv[2] || path.join("benchmarks", "swe-bench", "cache", "verified_tasks.json")
  );
  const tasks = [];
  for (let offset = 0; offset < 500; offset += 50) {
    const url = `${ENDPOINT}?dataset=${encodeURIComponent(DATASET)}&config=default&split=test&offset=${offset}&length=50`;
    const data = await fetchPage(url);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    tasks.push(...rows.map((row) => stripGoldFields(row.row || row)));
    if (rows.length < 50) break;
  }
  const unique = [...new Map(tasks.map((task) => [task.instance_id, task])).values()];
  const payload = {
    dataset: DATASET,
    source: "huggingface-datasets-server",
    fetchedAt: new Date().toISOString(),
    count: unique.length,
    tasks: unique,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[fetch:verified] wrote ${unique.length} tasks to ${output}`);
}

main().catch((error) => {
  console.error(`[fetch:verified] FAIL ${error.message}`);
  process.exit(1);
});

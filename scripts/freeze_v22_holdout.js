#!/usr/bin/env node
/**
 * Freeze a 2.2-specific unseen holdout, disjoint from the sealed v2.1 holdout.
 * Does NOT open outcomes. Do not run until two qualifying development A/B runs pass.
 */
const path = require("node:path");
const { freezeHoldout } = require("./freeze_v21_holdout");

function parseArgs(argv) {
  const args = {
    source: "",
    seenRoots: [],
    output: path.resolve("benchmarks/swe-bench/holdout/v2.2/manifest.json"),
    count: 20,
    seed: 2202,
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--source") args.source = path.resolve(argv[++i] || "");
    else if (argv[i] === "--seen-root") args.seenRoots.push(path.resolve(argv[++i] || ""));
    else if (argv[i] === "--output") args.output = path.resolve(argv[++i] || "");
    else if (argv[i] === "--count") args.count = Number(argv[++i] || 20);
    else if (argv[i] === "--seed") args.seed = Number(argv[++i] || 2202);
  }
  if (!args.source) throw new Error("--source is required");
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  // Always exclude the sealed v2.1 holdout identities.
  args.seenRoots.push(path.resolve("benchmarks/swe-bench/holdout/manifest.json"));
  const manifest = freezeHoldout(args);
  manifest.kind = "mogu-v2.2-unseen-holdout";
  manifest.disjointFrom = "benchmarks/swe-bench/holdout/manifest.json";
  require("fs").writeFileSync(args.output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(
    `[v2.2:holdout] froze ${manifest.taskCount} tasks; excluded ${manifest.excludedSeenCount}/${manifest.sourceTaskCount}`
  );
  console.log("[v2.2:holdout] NOT OPENED — outcomes must remain sealed until qualifying A/B passes");
}

module.exports = { parseArgs };

#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const INSTANCE_ID = /[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+-\d+/g;
const TEXT_EXTENSIONS = new Set([".json", ".jsonl", ".md", ".txt", ".yaml", ".yml"]);

function walkTextFiles(root, out = []) {
  if (!root || !fs.existsSync(root)) return out;
  if (fs.statSync(root).isFile()) {
    if (TEXT_EXTENSIONS.has(path.extname(root).toLowerCase())) out.push(root);
    return out;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) walkTextFiles(abs, out);
    else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(abs);
  }
  return out;
}

function collectSeenIds(roots) {
  const seen = new Set();
  for (const root of roots) {
    for (const file of walkTextFiles(root)) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(INSTANCE_ID)) seen.add(match[0]);
    }
  }
  return seen;
}

function seededShuffle(items, seed) {
  let state = Number(seed) >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function freezeHoldout({ source, seenRoots = [], output, count = 20, seed = 2101 }) {
  const sourceData = JSON.parse(fs.readFileSync(source, "utf8"));
  const tasks = Array.isArray(sourceData) ? sourceData : sourceData.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("source has no tasks");
  const seen = collectSeenIds(seenRoots);
  const candidates = tasks.filter((task) => task?.instance_id && !seen.has(task.instance_id));
  if (candidates.length < count) {
    throw new Error(`only ${candidates.length} unseen tasks remain; requested ${count}`);
  }
  const selected = seededShuffle(
    candidates.map((task) => ({
      instance_id: task.instance_id,
      repo: task.repo,
      base_commit: task.base_commit,
      binding_sha256: crypto
        .createHash("sha256")
        .update(`${task.instance_id}\n${task.repo || ""}\n${task.base_commit || ""}`)
        .digest("hex"),
    })),
    seed
  )
    .slice(0, count)
    .sort((a, b) => a.instance_id.localeCompare(b.instance_id));

  const manifest = {
    schemaVersion: 1,
    kind: "mogu-v2.1-unseen-holdout",
    frozen: true,
    sourceDataset: sourceData.dataset || "SWE-bench/SWE-bench_Lite",
    sourceTaskCount: tasks.length,
    exclusionPolicy: "all instance IDs found in declared historical run roots",
    excludedSeenCount: tasks.filter((task) => seen.has(task.instance_id)).length,
    selectionSeed: Number(seed),
    taskCount: selected.length,
    noGoldFields: true,
    tasks: selected,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function parseArgs(argv) {
  const args = { source: "", seenRoots: [], output: "", count: 20, seed: 2101 };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--source") args.source = path.resolve(argv[++i] || "");
    else if (argv[i] === "--seen-root") args.seenRoots.push(path.resolve(argv[++i] || ""));
    else if (argv[i] === "--output") args.output = path.resolve(argv[++i] || "");
    else if (argv[i] === "--count") args.count = Number(argv[++i] || 20);
    else if (argv[i] === "--seed") args.seed = Number(argv[++i] || 2101);
  }
  if (!args.source || !args.output) throw new Error("--source and --output are required");
  return args;
}

if (require.main === module) {
  const manifest = freezeHoldout(parseArgs(process.argv));
  console.log(
    `[v2.1:holdout] froze ${manifest.taskCount} tasks; excluded ${manifest.excludedSeenCount}/${manifest.sourceTaskCount}`
  );
}

module.exports = { collectSeenIds, freezeHoldout, seededShuffle };

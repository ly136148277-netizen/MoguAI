#!/usr/bin/env node
const fs = require("fs-extra");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PRIVATE = path.join(ROOT, "benchmarks", "private");
const TASKS = path.join(PRIVATE, "tasks.json");
const EXAMPLE = path.join(PRIVATE, "tasks.example.json");

function normalizeTask(t) {
  const id = t.instance_id || t.id;
  return { ...t, instance_id: id, id };
}

function isForbiddenSource(source) {
  const s = String(source || "").toLowerCase();
  return /cursor|trae|cursor_trae|vendor_private|proprietary/.test(s) && !/moguai_private/.test(s);
}

function main() {
  const src = fs.pathExistsSync(TASKS) ? TASKS : EXAMPLE;
  const data = fs.readJsonSync(src);
  if (!Array.isArray(data.tasks) || !data.tasks.length) {
    console.error("[bench:private:validate] tasks 为空");
    process.exit(1);
  }
  const errors = [];
  for (const raw of data.tasks) {
    const t = normalizeTask(raw);
    if (!t.instance_id) errors.push("missing id/instance_id");
    if (!t.prompt) errors.push(`${t.instance_id || "?"}: missing prompt`);
    if (!t.workspace && !t.repo) {
      errors.push(`${t.instance_id}: need workspace or repo`);
    }
    if (isForbiddenSource(t.source)) {
      errors.push(`${t.instance_id}: source=${t.source} 不允许（竞品未公开题库）`);
    }
  }
  if (errors.length) {
    console.error("[bench:private:validate] FAIL\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log(
    `[bench:private:validate] ok file=${path.basename(src)} tasks=${data.tasks.length}`
  );
  console.log("提醒：仅 MOGUAI_PRIVATE / 自有题。");
}

main();

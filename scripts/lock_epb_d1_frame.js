/**
 * Pre-register EPB D1 expansion frame (batch1=50, batch2≤50) — run once.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const full = JSON.parse(
  fs.readFileSync(path.join(ROOT, "benchmarks/swe-bench/cache/tasks_full_lite.json"), "utf8")
);
const b1 = new Set(
  fs
    .readFileSync(
      path.join(ROOT, "benchmarks/swe-bench/runs/post_s3/b1_lite50/instance_ids.txt"),
      "utf8"
    )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
);
const a0 = new Set([
  "astropy__astropy-12907",
  "astropy__astropy-14995",
  "astropy__astropy-6938",
  "astropy__astropy-14182",
  "astropy__astropy-14365",
  "astropy__astropy-7746",
  "django__django-10914",
  "django__django-10924",
]);
const hard = new Set([
  "django__django-13265",
  "django__django-11019",
  "django__django-15695",
  "django__django-12497",
  "django__django-15781",
]);

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

const frame = full.tasks
  .filter((t) => {
    const id = t.instance_id;
    const repo = String(t.repo || id);
    if (!/django\//i.test(repo) && !/^django__/i.test(id)) return false;
    if (b1.has(id) || a0.has(id) || hard.has(id)) return false;
    return true;
  })
  .map((t) => t.instance_id);

const seed = "20260723";
const shuffled = shuffle(frame, seed);
const batch1 = shuffled.slice(0, 50);
const batch2 = shuffled.slice(50, 100);
const dir = path.join(
  ROOT,
  "benchmarks/swe-bench/runs/post_s3/b1_lite50/controlled_trials/b2_evidence_to_patch"
);
const out = {
  protocol: "D1_EXPANSION_PROTOCOL.md",
  seed,
  frame_repo: "django_only_ClassC_capable",
  exclude: { b1_lite50: true, a0_lite8: true, hard_exclude: [...hard] },
  frame_n: frame.length,
  batch1_n: batch1.length,
  batch2_n: batch2.length,
  total_cap: 100,
  batch1,
  batch2,
  createdAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(dir, "D1_EXPANSION_FRAME.json"), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(dir, "d1_batch1_ids.txt"), `${batch1.join("\n")}\n`);
fs.writeFileSync(path.join(dir, "d1_batch2_ids.txt"), `${batch2.join("\n")}\n`);
console.log(
  JSON.stringify(
    {
      frame_n: frame.length,
      batch1: batch1.length,
      batch2: batch2.length,
      batch1_head: batch1.slice(0, 5),
      batch2_head: batch2.slice(0, 5),
    },
    null,
    2
  )
);

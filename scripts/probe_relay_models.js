/**
 * Pre-flight probe for manylisten (or OPENAI_BASE_URL) models.
 * Writes JSON + markdown under benchmarks/swe-bench/runs/_probe/ (or --out).
 *
 * Rules (hard):
 * - List which models are OK / FAIL this moment.
 * - Never mix models inside one k=N cohort. If mid-run the locked model 503s,
 *   abort the whole cohort and re-run; do not splice another model into results.
 *
 *   $env:OPENAI_API_KEY=...
 *   $env:OPENAI_BASE_URL=https://ai-api-router.manylisten.ccwu.cc/v1
 *   node scripts/probe_relay_models.js
 *   node scripts/probe_relay_models.js --require gpt-5.5 --fail-exit
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const argv = process.argv.slice(2);

function flagValue(name) {
  const idx = argv.indexOf(name);
  if (idx < 0) return "";
  const next = argv[idx + 1];
  if (!next || next.startsWith("--")) return "";
  return next;
}

const base = String(process.env.OPENAI_BASE_URL || "").replace(/\/$/, "");
const key = String(process.env.OPENAI_API_KEY || process.env.MOGU_API_KEY || "").trim();
const outDir =
  flagValue("--out") ||
  path.join(ROOT, "benchmarks", "swe-bench", "runs", "_probe");
const requireModel = flagValue("--require") || process.env.MOGU_BENCH_MODEL || "gpt-5.5";
const failExit = argv.includes("--fail-exit");
const timeoutMs = Math.max(3000, Number(flagValue("--timeout-ms") || 12000) || 12000);

const DEFAULT_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.6-sol",
  "gpt-5.6",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
];

if (!base || !key) {
  console.error("需要 OPENAI_BASE_URL + OPENAI_API_KEY");
  process.exit(2);
}

async function chat(model) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "PONG" }],
        max_tokens: 4,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return {
      model,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t0,
      err: res.ok ? "" : text.replace(/\s+/g, " ").slice(0, 120),
    };
  } catch (e) {
    return {
      model,
      ok: false,
      status: 0,
      ms: Date.now() - t0,
      err: e.message || String(e),
    };
  }
}

(async () => {
  const models = (flagValue("--models") || DEFAULT_MODELS.join(","))
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`[probe] base=${base} require=${requireModel} n=${models.length}`);
  const rows = [];
  for (const m of models) {
    const r = await chat(m);
    rows.push(r);
    console.log(
      `[probe] ${r.ok ? "OK  " : "FAIL"} ${m} status=${r.status} ms=${r.ms}${r.err ? ` ${r.err}` : ""}`
    );
  }

  const ok = rows.filter((r) => r.ok).map((r) => r.model);
  const fail = rows.filter((r) => !r.ok).map((r) => r.model);
  const requiredOk = rows.some((r) => r.model === requireModel && r.ok);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(outDir, { recursive: true });
  const payload = {
    at: new Date().toISOString(),
    base,
    requireModel,
    requiredOk,
    ok,
    fail,
    rows,
    policy: {
      experimentalPrimary: "gpt-5.5",
      designDefault: "gpt-5.6-sol",
      noMixInCohort:
        "If the locked model 503s mid k=N cohort, abort entire cohort and re-run. Never splice another model into the same result set.",
    },
  };
  const jsonPath = path.join(outDir, `probe-${stamp}.json`);
  const latestPath = path.join(outDir, "probe-latest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2), "utf8");

  const md = [
    `# Relay model probe — ${payload.at}`,
    "",
    `- base: \`${base}\``,
    `- experimental primary (locked for Post-S3): **gpt-5.5**`,
    `- design default (sol): gpt-5.6-sol — probe-only until stable`,
    `- require for this run: \`${requireModel}\` → **${requiredOk ? "OK" : "FAIL"}**`,
    "",
    "## OK",
    ...(ok.length ? ok.map((m) => `- \`${m}\``) : ["- _(none)_"]),
    "",
    "## FAIL",
    ...(fail.length ? fail.map((m) => `- \`${m}\``) : ["- _(none)_"]),
    "",
    "## Hard rule",
    "",
    "> Do not mix models inside one k=N cohort. Mid-run 503 → abort & re-run whole cohort.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "probe-latest.md"), md, "utf8");
  console.log(`[probe] wrote ${latestPath}`);
  console.log(`[probe] ok=[${ok.join(", ")}] fail=[${fail.join(", ")}]`);

  if (failExit && !requiredOk) {
    console.error(`[probe] required model ${requireModel} not available — refuse to start cohort`);
    process.exit(4);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

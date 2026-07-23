#!/usr/bin/env node
/**
 * CLI install of MOGU AI coding engines (adapted pin from compat table).
 */
const os = require("os");
const path = require("path");
const { installOrUpgradeRuntime, probeAll, checkRuntimeUpdates } =
  require("../src/main/moguai/coding");

async function main() {
  // Ensure uv (engine B) is visible when installed to ~/.local/bin
  const uvBin = path.join(os.homedir(), ".local", "bin");
  if (require("fs").existsSync(uvBin) && !String(process.env.Path || process.env.PATH || "").includes(uvBin)) {
    process.env.Path = `${uvBin};${process.env.Path || process.env.PATH || ""}`;
    process.env.PATH = process.env.Path;
  }

  const engine = process.argv.includes("--a")
    ? "moguai_a"
    : process.argv.includes("--b")
      ? "moguai_b"
      : "all";
  const userDataPath =
    process.env.MOGU_USER_DATA ||
    path.join(os.homedir(), "AppData", "Roaming", "ai-model-manager");
  const settings = { userDataPath };

  console.log(`[install-runtime] userData=${userDataPath}`);
  console.log(`[install-runtime] engine=${engine}`);

  const before = await checkRuntimeUpdates(settings);
  console.log(`[install-runtime] check: ${before.summary || before.ctaMessage || ""}`);

  const result = await installOrUpgradeRuntime({
    engine,
    settings,
    onProgress: (p) => {
      if (p?.message) console.log(`  … ${p.engine || ""} ${p.message}`);
    },
  });

  console.log(JSON.stringify({ ok: result.ok, message: result.message, results: result.results }, null, 2));
  const probed = probeAll(settings);
  for (const key of ["moguai_a", "moguai_b"]) {
    const e = probed.engines?.[key];
    console.log(`[probe] ${key}: installed=${Boolean(e?.installed)} ${e?.message || ""}`);
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`[install-runtime] FAIL ${err.message}`);
  process.exit(1);
});

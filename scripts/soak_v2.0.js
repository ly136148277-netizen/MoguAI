#!/usr/bin/env node
/**
 * v2.0 soak — runs acceptance_v2.0 then reminds stable cut steps.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCmd, ["run", "acceptance:v2.0"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
});
if (result.status !== 0) process.exit(result.status || 1);

console.log(`
v2.0 soak green.
Stable cut: npm run preflight:release → tag v2.0.0 → publish_mogu_releases.ps1
`);
process.exit(0);

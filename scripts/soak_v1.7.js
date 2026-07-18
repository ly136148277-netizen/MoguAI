#!/usr/bin/env node
/**
 * v1.7 soak — runs acceptance_v1.7 then reminds stable cut steps.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCmd, ["run", "acceptance:v1.7"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
});
if (result.status !== 0) process.exit(result.status || 1);

console.log(`
v1.7 soak green.
Stable cut: bump to 1.7.0 → npm run preflight:release → tag v1.7.0 → publish_mogu_releases.ps1
`);
process.exit(0);

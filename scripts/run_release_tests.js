#!/usr/bin/env node
/**
 * Run required source/static release gates and emit a machine-readable report.
 * Packaging is run separately so final signed artifacts can be tested afterward.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function parseArgs(argv) {
  const out = {
    output: path.resolve("dist", "release-test-report.json"),
    appOut: path.resolve("dist", "win-unpacked"),
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--output") out.output = path.resolve(argv[++i] || "");
    else if (argv[i] === "--app-out") out.appOut = path.resolve(argv[++i] || "");
  }
  return out;
}

function runReleaseTests({ output, appOut }) {
  const npmCheck = (id, args) =>
    process.platform === "win32"
      ? {
          id,
          command: process.env.ComSpec || "cmd.exe",
          args: ["/d", "/s", "/c", ["npm", ...args].join(" ")],
          display: ["npm", ...args].join(" "),
        }
      : { id, command: "npm", args, display: ["npm", ...args].join(" ") };
  const checks = [
    npmCheck("unit", ["test"]),
    npmCheck("acceptance-v2", ["run", "acceptance:v2.0"]),
    npmCheck("acceptance-coding", ["run", "acceptance:coding"]),
    npmCheck("public-profile", ["run", "check:public-profile"]),
    {
      id: "asar-denylist",
      command: process.execPath,
      args: [
        "-e",
        `require('./build/asar-denylist').assertResourcesClean(${JSON.stringify(appOut)}); console.log('[asar-denylist] PASS')`,
      ],
      display: `node asar-denylist ${path.relative(path.resolve(__dirname, ".."), appOut).split(path.sep).join("/")}`,
    },
  ];

  const startedAt = new Date().toISOString();
  const commands = [];
  for (const check of checks) {
    const display = check.display || [check.command, ...check.args].join(" ");
    console.log(`\n[release-tests] ${check.id}: ${display}`);
    const result = spawnSync(check.command, check.args, {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
      windowsHide: true,
    });
    const exitCode = Number.isInteger(result.status) ? result.status : 1;
    commands.push({
      id: check.id,
      command: display,
      exitCode,
      status: exitCode === 0 ? "pass" : "fail",
      ...(result.error ? { error: result.error.message } : {}),
    });
    if (exitCode !== 0) break;
  }

  const report = {
    schemaVersion: 1,
    kind: "release-test-report",
    startedAt,
    endedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    appOut: path.relative(path.resolve(__dirname, ".."), appOut).split(path.sep).join("/"),
    result: commands.length === checks.length && commands.every((item) => item.exitCode === 0) ? "pass" : "fail",
    commands,
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\n[release-tests] wrote ${output} result=${report.result}`);
  return report;
}

if (require.main === module) {
  const report = runReleaseTests(parseArgs(process.argv));
  if (report.result !== "pass") process.exit(1);
}

module.exports = { parseArgs, runReleaseTests };

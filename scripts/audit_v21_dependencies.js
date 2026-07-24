#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const EXPECTED = {
  "node-pty": {
    version: "1.1.0",
    license: "MIT",
    integrity: "sha512-20JqtutY6JPXTUnL0ij1uad7Qe1baT46lyolh2sSENDd4sTzKZ4nmAFkeAARDKwmlLjPx6XKRlwRUxwjOy+lUg==",
  },
  "node-addon-api": { version: "7.1.1", license: "MIT" },
};

function audit(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const failures = [];
  if (pkg.dependencies?.["node-pty"] !== EXPECTED["node-pty"].version) {
    failures.push("node-pty must be exact-pinned to 1.1.0");
  }
  const pty = lock.packages?.["node_modules/node-pty"];
  const addon = lock.packages?.["node_modules/node-pty/node_modules/node-addon-api"];
  for (const [name, actual] of [
    ["node-pty", pty],
    ["node-addon-api", addon],
  ]) {
    const expected = EXPECTED[name];
    if (!actual) failures.push(`${name} missing from package lock`);
    else {
      if (actual.version !== expected.version) failures.push(`${name} version drift`);
      if (actual.license !== expected.license) failures.push(`${name} license drift`);
      if (expected.integrity && actual.integrity !== expected.integrity) failures.push(`${name} integrity drift`);
    }
  }
  if (!fs.existsSync(path.join(root, "THIRD_PARTY_NOTICES.md"))) failures.push("third-party notices missing");
  const unpack = Array.isArray(pkg.build?.asarUnpack) ? pkg.build.asarUnpack : [];
  if (!unpack.includes("node_modules/node-pty/**/*")) failures.push("node-pty native files not ASAR-unpacked");
  return { ok: failures.length === 0, failures, expected: EXPECTED };
}

if (require.main === module) {
  const result = audit();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

module.exports = { audit, EXPECTED };

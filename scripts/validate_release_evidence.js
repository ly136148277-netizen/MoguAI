#!/usr/bin/env node
const path = require("path");
const { validateEvidence } = require("./generate_release_evidence");
const fs = require("fs");

const input = process.argv[2] || path.resolve("dist", "release-evidence-manifest.json");
if (!fs.existsSync(input)) {
  console.error(`[validate:release-evidence] missing ${input}`);
  process.exit(1);
}
const evidence = JSON.parse(fs.readFileSync(input, "utf8"));
const result = validateEvidence(evidence);
if (!result.ok) {
  console.error("[validate:release-evidence] FAIL");
  console.error(result.errors.join("\n"));
  process.exit(1);
}
console.log("[validate:release-evidence] PASS");

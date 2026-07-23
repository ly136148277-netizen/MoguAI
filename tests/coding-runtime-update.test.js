const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  compareVersions,
  getCompatManifest,
  decideUpgradeState,
  writeEngineEntry,
  writeInstalledVersion,
  readInstalledVersion,
  uvAvailable,
  COMPAT_PATH,
} = require("../src/main/moguai/coding/runtime-update");

describe("moguai coding runtime-update", () => {
  it("loads bundled compat manifest with both engines", () => {
    const m = getCompatManifest(COMPAT_PATH);
    assert.equal(m.ok, true);
    assert.ok(m.engines.moguai_a?.adaptedVersion);
    assert.ok(m.engines.moguai_b?.adaptedVersion);
    assert.equal(m.engines.moguai_a.fetch.type, "npm");
    assert.equal(m.engines.moguai_b.fetch.type, "github_zip");
  });

  it("compareVersions orders semver", () => {
    assert.equal(compareVersions("0.144.6", "0.144.6"), 0);
    assert.equal(compareVersions("0.144.5", "0.144.6"), -1);
    assert.equal(compareVersions("0.145.0", "0.144.6"), 1);
    assert.equal(compareVersions("v0.1.0", "0.1.0"), 0);
  });

  it("decideUpgradeState: install when missing", () => {
    const d = decideUpgradeState({
      installedVersion: null,
      adaptedVersion: "0.144.6",
      officialLatest: "0.144.6",
      probeInstalled: false,
    });
    assert.equal(d.canUpgrade, true);
    assert.equal(d.action, "install");
  });

  it("decideUpgradeState: wait_adapt when official ahead and local matched", () => {
    const d = decideUpgradeState({
      installedVersion: "0.144.6",
      adaptedVersion: "0.144.6",
      officialLatest: "0.145.0",
      probeInstalled: true,
    });
    assert.equal(d.canUpgrade, false);
    assert.equal(d.action, "wait_adapt");
    assert.match(d.message, /官方已有/);
  });

  it("decideUpgradeState: upgrade when local behind adapted", () => {
    const d = decideUpgradeState({
      installedVersion: "0.140.0",
      adaptedVersion: "0.144.6",
      officialLatest: "0.145.0",
      probeInstalled: true,
    });
    assert.equal(d.canUpgrade, true);
    assert.equal(d.action, "upgrade");
  });

  it("uvAvailable returns boolean without throwing", () => {
    assert.equal(typeof uvAvailable(), "boolean");
  });

  it("writeEngineEntry creates moguai-coding wrapper and VERSION.json roundtrip", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moguai-entry-"));
    try {
      const scriptRel = path.join("node_modules", "@scope", "pkg", "bin", "cli.js");
      await fs.ensureDir(path.dirname(path.join(dir, scriptRel)));
      await fs.writeFile(path.join(dir, scriptRel), "console.log('ok')\n", "utf8");
      const written = writeEngineEntry(dir, {
        cliName: "moguai-coding-a",
        kind: "node",
        script: "node_modules/@scope/pkg/bin/cli.js",
      });
      assert.equal(written.ok, true);
      if (process.platform === "win32") {
        assert.ok(await fs.pathExists(path.join(dir, "moguai-coding-a.cmd")));
      } else {
        assert.ok(await fs.pathExists(path.join(dir, "moguai-coding-a")));
      }
      writeInstalledVersion(dir, {
        adaptedVersion: "0.144.6",
        source: "npm:@openai/codex@0.144.6",
        engine: "moguai_a",
      });
      const ver = readInstalledVersion(dir);
      assert.equal(ver.adaptedVersion, "0.144.6");
      assert.match(ver.source, /npm:/);
    } finally {
      await fs.remove(dir);
    }
  });
});

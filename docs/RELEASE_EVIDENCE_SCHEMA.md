# Release Evidence Manifest Schema

```yaml
schemaVersion: 1
kind: release-evidence-manifest
```

## Rules

1. Evidence Manifest **must not** record its own SHA-256.
2. `publicReleaseEligible` may be `true` only when:
   - working tree clean
   - payload manifest present
   - signing status is `signed/verified`, Authenticode is valid, and timestamp is verified
   - exact RC tag and source commit are recorded
   - Public Build Profile and machine-readable test report are hashed
   - all required tests and all four gates are `pass`
   - Installed Runtime E2E performed
   - upload re-download verification performed
   - blockers array empty
3. Unsigned builds must set `signing.status = "unsigned/internal-preview"`.
4. Never embed tokens, passwords, certificate material, or env values.

## Required fields

- `product.name` / `product.version` / `product.appId`
- `source.commit` / `source.tag` / `source.cleanTree`
- `hashes.packageLock` / `hashes.publicBuildProfile` / `hashes.payloadManifest` / `hashes.testReport`
- `toolchain.node` / `toolchain.electron` / `toolchain.electronBuilder`
- `signing.status` / `signing.signatureVerified` / `signing.timestampStatus` / `signing.cscConfigured`
- `releaseSet[]` with `path`, `bytes`, `sha256`, `kind`
- `tests.commands` / `tests.results` / `tests.ranAt` / `tests.environment`
- `gates.source` / `gates.artifact` / `gates.installedRuntime` / `gates.uploadRecheck`
- `blockers[]`

## Commands

```powershell
npm run check:public-profile -- --output dist/public-build-profile.json
npm run evidence:test -- --app-out dist/win-unpacked --output dist/release-test-report.json
npm run manifest:payload -- --input dist --output dist/payload-manifest.json --version <version>
npm run manifest:validate -- dist/payload-manifest.json dist
npm run evidence:generate -- --payload dist/payload-manifest.json --profile dist/public-build-profile.json --tests-report dist/release-test-report.json --output dist/release-evidence-manifest.json
npm run evidence:validate -- dist/release-evidence-manifest.json
```

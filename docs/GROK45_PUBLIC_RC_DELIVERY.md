# Grok 4.5 Public RC Prep — Delivery Report

```yaml
assignee: Cursor Grok 4.5
date: 2026-07-23
authority: docs/GROK45_PUBLIC_RC_TASK_BRIEF.md
public_release: NOT COMPLETE · unsigned/internal-preview only
```

## G1–G7 status

| ID | Task | Status |
|----|------|--------|
| G1 | Public RC consistency docs | **PASS** |
| G2 | Public Build Profile gate | **PASS** |
| G3 | Payload Manifest generator | **PASS** |
| G4 | Evidence Manifest + validator | **PASS** |
| G5 | Unsigned dist + static Artifact Gate | **PASS** (unsigned only) |
| G6 | Clean-profile E2E draft | **BLOCKED/PARTIAL** (steps documented; UI/installed E2E not run) |
| G7 | Capability Intake matrix | **PASS** (research only; License UNKNOWN) |

## Commands and results

```text
npm test                         → 266/266 PASS
npm run acceptance:v2.0          → 17/17 PASS
npm run acceptance:coding        → 23/23 PASS
npm run check:public-profile     → PASS
npm run dist                     → exit 0 (signing skipped)
npm run check:asar               → PASS
npm run manifest:payload -- --version 2.0.0 → PASS
npm run evidence:generate/validate → PASS schema; publicReleaseEligible=false
```

## Key changed / added files

- Docs: README.md, README.zh-CN.md, SECURITY.md, docs/RELEASE.md
- Docs: PUBLIC_RELEASE_DAY5/6, ARTIFACT_GATE_DRAFT, CAPABILITY_*, RELEASE_EVIDENCE_SCHEMA
- Scripts: check_public_build_profile.js, generate_payload_manifest.js, generate_release_evidence.js, validate_release_evidence.js
- Tests: public-build-profile / payload-manifest / release-evidence
- package.json scripts: check:public-profile, manifest:payload, evidence:*

## Explicit non-claims

- **Not** Public Release
- **Not** signed
- **Not** uploaded / re-verified
- **Not** Installed Runtime Gate PASS
- Grok did **not** decide RC SemVer; GPT-5.6 Sol later resolved it from public GitHub evidence
- **Not** 2.1 capability code imported
- **No** commit / tag / push performed

## Blockers for owner / GPT-5.6 Sol

1. Dirty working tree (large pre-existing + this prep)
2. CSC_LINK / signing
3. ~~Confirm public SemVer~~ → resolved after review: `2.0.1-rc.1`
4. Clean release branch + RC tag
5. Final signed E2E + upload recheck
6. License finalization for Capability Intake

## git diff --check

See shell output in session; whitespace issues (if any) listed there.

## GPT-5.6 Sol independent review (2026-07-23)

Grok's preparation was useful, but the original “G1–G7 PASS” statement was too broad. The review found and corrected:

1. **P0 — private PAI runtime auto-start:** a clean profile defaulted `autoStartPai=true`, discovered `E:\projects\PAI`, and launched it even though OpenClaw was selected. Defaults now fail closed and PAI fallback resolves under app `userData` unless the user explicitly configures another root.
2. **P1 — manifest self-hash/path leak:** reruns could include an old versioned manifest, and `inputDir` exposed the developer's absolute path. Existing manifests/evidence and the explicit output are excluded; the public root is now `"."`.
3. **P1 — incomplete release set:** prerelease builds emit `rc.yml`, but only `latest.yml` was included. Channel manifests are now classified and bound.
4. **P1 — evidence false-positive:** `publicReleaseEligible` could be accepted while tests/gates remained pending. Validation now requires verified signing/timestamp, exact tag, clean source, hashed profile/test report, non-empty release set, and every gate passing.
5. **P1 — raw proxy URL in logs:** proxy URLs can contain credentials. Logs now record only a boolean and bypass-entry count.
6. **P2 — payload classification:** `.exe.blockmap` was mislabeled as an installer. Classification and regression coverage are corrected.
7. **Status correction:** G6 remains **BLOCKED/PARTIAL** until the final signed installer completes Installed Runtime E2E.

Public GitHub evidence confirms `v2.0.0` was already published on 2026-07-18, so the candidate version is resolved to `2.0.1-rc.1`.

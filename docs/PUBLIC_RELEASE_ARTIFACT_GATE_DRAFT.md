# Artifact Gate Draft — Unsigned Internal Preview（Grok G5）

```yaml
date: 2026-07-23
status: PASS for unsigned/internal-preview static checks · NOT Public Release
signing: skipped (CSC_LINK unset)
```

## Commands run

| Command | Exit |
|---------|------|
| `npm test` | 0 · **266/266** |
| `npm run acceptance:v2.0` | 0 · **17/17** |
| `npm run acceptance:coding` | 0 · **23/23** |
| `npm run check:public-profile` | 0 · PASS |
| `npm run dist` | 0 · NSIS + Portable built; signing skipped |
| `npm run check:asar` | 0 · denylist OK (2739 entries) |
| `npm run manifest:payload -- --version 2.0.0` | 0 |
| `npm run evidence:generate` / `evidence:validate` | 0 · eligible=false |

## Current 2.0.0 candidate files

| File | Role | Signed |
|------|------|--------|
| `dist/MOGU-AI-Setup-2.0.0.exe` | NSIS installer | **No** |
| `dist/MOGU AI 2.0.0.exe` | Portable / 免安装版 | **No** |
| `dist/MOGU-AI-Setup-2.0.0.exe.blockmap` | blockmap (pre-final-sign) | n/a |
| `dist/win-unpacked/resources/app.asar` | app payload | n/a |

`config/moguai-runtime-compat.json` **present** inside app.asar.

## Scans

- ASAR denylist: PASS
- Public Build Profile: PASS
- Naive “token” string scan on asar paths: many false positives under monaco/axios (`*Token*.js`); **no** `secrets.json` / `github.token` / `.env` / `xuzhou_*` / `scripts/` hits from denylist.

## Important caveats

1. `dist/` still contains **historical** 1.x/legacy installers. Release Set for upload must be **version-filtered** (`--version 2.0.0`) or built in a clean output dir.
2. Evidence blockers remain: dirty tree · unsigned · no install E2E · no upload recheck · no CSC.
3. This draft **must not** be labeled Public Release.

## Owner next

Sign → re-hash → Installed Runtime E2E → upload → re-download verify → publish `latest.yml` last.

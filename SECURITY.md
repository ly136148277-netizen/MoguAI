# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 2.0.x   | ✅ current |
| 1.7.x / 1.6.x / 1.5.5+ | Best effort |
| 1.5.4   | ❌ yanked — do not install |
| < 1.5   | Best effort |

## Reporting a vulnerability

Please **do not** open public issues for security problems.

Email or DM the maintainer via GitHub: [@ly136148277-netizen](https://github.com/ly136148277-netizen)

Include:

- Description of the issue
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

We aim to respond within 7 days.

## Security notes for users

- MOGU AI runs locally; model files and chat history stay on your machine under `%APPDATA%\ai-model-manager\`.
- Portable builds share the same AppData path as the NSIS installer (免安装版 ≠ self-contained profile).
- Uninstall keeps AppData by default.
- Executor choice is explicit (Brain / OpenClaw / PAI); OpenClaw→PAI fallback is **off** unless the user enables it.
- The AI agent can execute system tasks when a runtime is enabled — use L1/L2/L3 permission levels carefully. L3 always reconfirms.
- API keys are stored via Electron `safeStorage` only (fail-closed). If encryption is unavailable, the app refuses to save keys and never writes plaintext.
- Host `OPENAI_API_KEY` is **not** inherited by default; opt-in with `MOGU_ALLOW_HOST_API_KEY=1` for local/dev only.
- Studio cancel binds to the current `runId` / `promptId`. Pending jobs use queue `delete`; running jobs use targeted `/interrupt` only when ComfyUI ≥ 0.3.56. Otherwise global clear requires explicit confirmation — never guessed from another job.
- `mogu-media` only serves files under allowlisted roots (PAI / ComfyUI / model storage / AppData) with media extensions.
- Do not share `config/github.token` or paste tokens into issues/PRs.
- Research / SWE-bench / EPB tracks are Default-Off and are not part of Public Release marketing.

## Packaging / release boundary

- Current candidate follows `package.json` (**2.0.1-rc.1**). Public GitHub evidence confirms `v2.0.0` already shipped.
- electron-builder uses an **explicit runtime file allowlist** (not `.gitignore`), including `config/moguai-runtime-compat.json`.
- Keep excluding from packs forever: `config/github.token`, `*.token`, `.env`, `secrets.json`, `config/mogu_*`, `config/xuzhou_*`, and `scripts/`.
- `build/afterPack.js` runs an ASAR denylist check; any hit fails the build.
- `npm run check:public-profile` is the Public Build Profile gate.
- Unsigned packages are **Internal Preview only** and must not be labeled Public Release.

## Release credentials (maintainers)

Prefer, in order:

1. `gh auth login` (GitHub CLI credential store)
2. Temporary shell `GH_TOKEN` / `GITHUB_TOKEN` (session only; unset after publish)

Avoid storing tokens under the project tree. If `config/github.token` is unavoidable, use a **short-lived, least-privilege** classic/fine-grained PAT and **revoke it immediately after publish**.

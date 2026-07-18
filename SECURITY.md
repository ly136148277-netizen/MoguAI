# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.5.x   | ✅        |
| 1.4.x   | Best effort |
| < 1.4   | Best effort |

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

- MOGU AI runs locally; model files and chat history stay on your machine.
- The AI agent can execute system tasks when PAI is enabled — use L1/L2/L3 permission levels carefully.
- API keys are stored via Electron `safeStorage` only (fail-closed). If encryption is unavailable, the app refuses to save keys and never writes plaintext.
- Studio cancel binds to the current `runId` / `promptId`. Pending jobs use queue `delete`; running jobs use targeted `/interrupt` only when ComfyUI ≥ 0.3.56. Otherwise global clear requires explicit confirmation — never guessed from another job.
- `mogu-media` only serves files under allowlisted roots (PAI / ComfyUI / model storage / AppData) with media extensions.
- Do not share `config/github.token` or paste tokens into issues/PRs.

## Packaging / release boundary

- Baseline for development and users: **v1.5.5+**. **v1.5.4 installers are permanently yanked** — do not install or redistribute them.
- electron-builder uses an **explicit runtime file allowlist** (not `.gitignore`).
- Keep excluding from packs forever: `config/github.token`, `*.token`, `.env`, `secrets.json`, local news configs, and `scripts/`.
- `build/afterPack.js` runs an ASAR denylist check; any hit fails the build.

## Release credentials (maintainers)

Prefer, in order:

1. `gh auth login` (GitHub CLI credential store)
2. Temporary shell `GH_TOKEN` / `GITHUB_TOKEN` (session only; unset after publish)

Avoid storing tokens under the project tree. If `config/github.token` is unavoidable, use a **short-lived, least-privilege** classic/fine-grained PAT and **revoke it immediately after publish**.

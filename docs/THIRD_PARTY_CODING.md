# Third-party coding engines NOTICE

MOGU AI’s coding bridge may invoke the following open-source tools **as external processes**. Their source is not bundled into the MOGU installer; local checkouts live under `D:\Project\vendor\` (or paths you configure).

## OpenAI Codex CLI

- Project: https://github.com/openai/codex  
- License: Apache License 2.0  
- Local checkout (optional): `D:\Project\vendor\openai-codex`  
- Runtime: system `codex`, or `npx @openai/codex`

Copyright notices and the Apache-2.0 license text are included in that repository’s `LICENSE` file. When redistributing a modified Codex binary or source, comply with Apache-2.0 (including NOTICE retention where applicable).

## ByteDance Trae Agent

- Project: https://github.com/bytedance/trae-agent  
- License: MIT License  
- Local checkout (optional): `D:\Project\vendor\trae-agent`  
- Runtime: `trae-cli` / `uv run trae-cli`

The Trae **IDE** product is separate and is **not** open-sourced as a whole. This bridge only integrates the **trae-agent** CLI component under MIT.

## MOGU responsibilities

- Attribution for downstream review packages: keep this file and link `docs/CODING_BRIDGE.md`.  
- Do not ship API keys, `trae_config.yaml` secrets, or Codex auth tokens inside MOGU installers or diagnostic/backup packs.  
- Product naming for public releases that use upstream trademarks remains subject to upstream permission (out of scope for the technical bridge).

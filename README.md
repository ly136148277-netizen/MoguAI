# Mogu AI · 蘑菇AI

**English** | [简体中文](./README.zh-CN.md)

> One desktop app for **GGUF model downloads**, **Ollama offline chat**, and an optional **AI task butler** — no terminal required.

[![Release](https://img.shields.io/github/v/release/ly136148277-netizen/mogu-ai-releases?label=download&sort=semver)](https://github.com/ly136148277-netizen/mogu-ai-releases/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6)](https://github.com/ly136148277-netizen/MoguAI)
[![Tests](https://img.shields.io/badge/tests-50%20passing-brightgreen)](#development)

<p align="center">
  <strong>Model hub · Download center · My models · AI chat · Task butler</strong>
</p>

---

## Why Mogu AI?

| Pain point | Mogu AI |
|------------|---------|
| Finding GGUF files on HuggingFace | Curated catalog + CDN sync (8+ models) |
| `ollama create` / Modelfile by hand | Auto-import after download |
| Scattered chat UIs | Built-in multi-session chat + Markdown export |
| Desktop automation (optional) | PAI-powered butler: ComfyUI, file search, backups |

Built with **Electron 35** · runs fully **offline** after models are downloaded · data stays on your machine.

---

## Features

- **Model store** — search, tags, favorites, CDN catalog sync
- **Download engine** — multi-thread, resume, SHA256 verify, mirror presets (Official / HF Mirror)
- **My models** — status, re-import, open folder, delete (GGUF + Ollama)
- **AI chat** — streaming, Markdown, prompt templates, session export
- **AI butler** *(optional)* — PAI integration, ComfyUI panel, L1/L2/L3 safety levels
- **i18n** — Chinese / English UI
- **Auto-update** — GitHub Releases (Windows)

**Bundled models (8):** Llama 3 8B, Qwen 2.5 7B/3B, Phi-3 Mini, Gemma 2 2B, DeepSeek R1 Distill 7B, Mistral 7B v0.3, Nomic Embed v1.5

**Requires:** [Ollama](https://ollama.com/) for chat & import · [PAI](https://github.com/) *(optional)* for butler features

---

## Download (Windows)

Pre-built installers:

👉 **[Releases — mogu-ai-releases](https://github.com/ly136148277-netizen/mogu-ai-releases/releases/latest)**

| File | Description |
|------|-------------|
| `蘑菇AI Setup x.y.z.exe` | NSIS installer |
| `蘑菇AI x.y.z.exe` | Portable |

---

## Quick start (from source)

```bash
git clone https://github.com/ly136148277-netizen/MoguAI.git
cd MoguAI
npm install
npm start
```

1. Install & start **Ollama**
2. Open **Model store** → download a model
3. Wait for auto-import → **Start chat**

```bash
npm test      # 50 tests
npm run dist  # Windows installer
```

---

## Architecture

```
Electron shell
├── Chat      → Ollama (local LLM)
├── Models    → GGUF download / storage / catalog CDN
└── Butler    → PAI HTTP (optional automation)
```

See [`docs/RELEASE.md`](./docs/RELEASE.md) for publishing, catalog CDN, and code signing.

---

## Project layout

```
MoguAI/
├── catalog/models.json    # Remote-synced model catalog
├── config/                # Mirrors, prompts, update feed
├── src/main/              # Electron main process
├── src/renderer/          # UI (vanilla JS)
├── tests/
└── assets/icon.png
```

---

## Contributing

PRs welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) · report issues in [GitHub Issues](https://github.com/ly136148277-netizen/MoguAI/issues).

**Please do not commit secrets** (`config/github.token`, personal API keys).

---

## License

[MIT](./LICENSE) — free for personal and commercial use.

---

<p align="center">
  If this project helps you, consider ⭐ starring the repo — it helps others discover it.
</p>

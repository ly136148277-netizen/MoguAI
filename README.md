# MOGU AI 1.5.3

**English** | [简体中文](./README.zh-CN.md)

<p align="center">
  <img src="assets/icon.png" width="112" alt="MOGU AI" />
</p>

<p align="center">
  <strong>Agent models · Local Agent · ComfyUI creation · Video compose</strong><br>
  <sub>An open-source local AI creation desktop app for Windows. Your models and media stay on your PC.</sub>
</p>

<p align="center">
  <a href="https://github.com/ly136148277-netizen/mogu-ai-releases/releases/latest"><strong>Download latest</strong></a>
  ·
  <a href="./docs/STUDIO_v1.5.md">Studio guide</a>
  ·
  <a href="./docs/SETUP_HUB_v1.5.md">Environment setup</a>
  ·
  <a href="https://github.com/ly136148277-netizen/MoguAI/issues">Report an issue</a>
</p>

[![Release](https://img.shields.io/github/v/release/ly136148277-netizen/mogu-ai-releases?label=download&sort=semver&color=0078D6)](https://github.com/ly136148277-netizen/mogu-ai-releases/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6)](https://github.com/ly136148277-netizen/MoguAI)
[![Version](https://img.shields.io/badge/version-1.5.3-22c55e)](https://github.com/ly136148277-netizen/mogu-ai-releases/releases/tag/v1.5.3)

---

## What is MOGU AI?

MOGU AI brings local models, a desktop Agent, ComfyUI workflows, and video assembly into one window. Download Agent models, ask the Agent to operate your PC, run your own ComfyUI image/video workflows, and arrange generated shots into a longer video.

It is not a cloud generation service. Ollama, PAI, ComfyUI, and FFmpeg run locally. Using an online model is always optional.

<p align="center">
  <img src="docs/images/01-home-v153.png" width="900" alt="MOGU AI 1.5.3 home" />
</p>

---

## What's included

### Agent models

- Browse, search, and download GGUF models
- Import completed downloads into Ollama for offline use
- Manage downloaded models and active downloads
- Choose a built-in guide, local Ollama model, or online API as the Agent's guidance model
- Online presets for DeepSeek, OpenAI, Qwen, Kimi, and custom OpenAI-compatible endpoints

<p align="center">
  <img src="docs/images/02-agent-models-v153.png" width="900" alt="Agent models" />
</p>

### Local Agent

- Open ComfyUI, list workflows, search files, and back up projects with natural language
- Ask how to install the environment or use Studio
- PAI permission levels and confirmation for risky operations
- Scheduled shutdown for long generation jobs
- Local PAI executes tasks; guidance can be built-in, local, or online

<p align="center">
  <img src="docs/images/03-agent-v153.png" width="900" alt="MOGU AI Agent" />
</p>

### ComfyUI Studio

- Import your own text-to-image and image-to-video workflows
- Separate character and action prompts
- Select resolution, quality, and video duration
- Apply prompts and parameters to compatible ComfyUI API workflows
- Pass a text-to-image result into the image-to-video stage
- View progress and output previews, interrupt a task, and clear the queue

Prefer **Save (API Format)** in ComfyUI. A workflow must match the task and model; uncommon nodes or wiring may prevent automatic parameter overrides.

<p align="center">
  <img src="docs/images/04-studio-v153.png" width="900" alt="ComfyUI Studio" />
</p>

### Video compose

- Arrange generated clips on a timeline
- Join clips end-to-end with FFmpeg
- Prepare a portable FFmpeg automatically on first use
- Preview the composed result
- Continue editing in Shotcut, Jianying, or a custom external tool

<p align="center">
  <img src="docs/images/05-compose-v153.png" width="900" alt="Video compose timeline" />
</p>

### One-stop environment setup

- Check and start Ollama
- Install, select, and connect PAI
- Scan for an existing ComfyUI installation
- Install portable FFmpeg without manual PATH setup
- See all four environment states on Home and Studio

<p align="center">
  <img src="docs/images/06-setup-v153.png" width="900" alt="Environment setup" />
</p>

---

## Download and install

The recommended file is **`MOGU-AI-Setup-1.5.3.exe`**:

1. Download it from [Releases](https://github.com/ly136148277-netizen/mogu-ai-releases/releases/latest)
2. Run the installer and choose an installation directory
3. Confirm installation; a round mushroom desktop shortcut is created automatically
4. Open Environment on first launch and configure Ollama, PAI, ComfyUI, and FFmpeg as needed

The portable build is **`MOGU.AI.1.5.3.exe`**. `latest.yml` and `.blockmap` are only for in-app updates.

### Requirements

- Windows 10 / 11, 64-bit
- About 300 MB for the app
- Several additional GB for local models
- [Ollama](https://ollama.com/) for local models and chat
- PAI and ComfyUI for creation workflows
- FFmpeg for video composition; it can be installed from the app

---

## ComfyUI workflows

Place workflow JSON files in either location:

- Recommended: `{PAI root}/workflows/`
- ComfyUI default: `{ComfyUI}/ComfyUI/user/default/workflows/`

Then open ComfyUI Studio, select a workflow, and enter generation parameters. The GGUF Agent catalog and ComfyUI workflow catalog are separate.

See [`docs/COMFYUI_WORKFLOWS.md`](./docs/COMFYUI_WORKFLOWS.md) and [`docs/STUDIO_v1.5.md`](./docs/STUDIO_v1.5.md).

---

## Development

```bash
git clone https://github.com/ly136148277-netizen/MoguAI.git
cd MoguAI
npm install
npm start

npm test
npm run screenshots
npm run dist
```

### Architecture

```text
Electron
├── Agent models  → GGUF downloads / Ollama / online APIs
├── Agent         → PAI HTTP / local capabilities
├── Studio        → PAI Studio / ComfyUI workflows
├── Video compose → FFmpeg / external editors
└── Environment   → Ollama / PAI / ComfyUI / FFmpeg
```

### Related repositories

- [`MoguAI`](https://github.com/ly136148277-netizen/MoguAI): Electron source
- [`mogu-ai-releases`](https://github.com/ly136148277-netizen/mogu-ai-releases): installers and auto-update metadata
- [`mogu-map`](https://github.com/ly136148277-netizen/mogu-map): GGUF catalog CDN

See [`docs/RELEASE.md`](./docs/RELEASE.md) for releases and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for contribution guidelines.

---

## License

[MIT](./LICENSE) — free for personal and commercial use.

# MOGU AI 2.0

**English** | [简体中文](./README.zh-CN.md)

<p align="center">
  <img src="assets/icon.png" width="112" alt="MOGU AI" />
</p>

<p align="center">
  <strong>Personal AI Control Center · Agent · Studio · Coding Factory</strong><br>
  <sub>An open-source local AI desktop app for Windows. Your models, chats, and creations stay on your PC.</sub>
</p>

<p align="center">
  <a href="https://github.com/ly136148277-netizen/mogu-ai-releases/releases/latest"><strong>Download latest</strong></a>
  ·
  <a href="./docs/PUBLIC_RELEASE_FINAL_FREEZE.md">Public RC plan</a>
  ·
  <a href="./docs/MOGU_NORTH_STAR_AND_CAPABILITY_FUSION.md">North star</a>
  ·
  <a href="https://github.com/ly136148277-netizen/MoguAI/issues">Report an issue</a>
</p>

[![Release](https://img.shields.io/github/v/release/ly136148277-netizen/mogu-ai-releases?label=download&sort=semver&color=0078D6)](https://github.com/ly136148277-netizen/mogu-ai-releases/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6)](https://github.com/ly136148277-netizen/MoguAI)
[![Version](https://img.shields.io/badge/version-2.0.1--rc.1-22c55e)](./package.json)

> **Current candidate:** `package.json` = **2.0.1-rc.1**. Public GitHub evidence confirms `v2.0.0` was published on 2026-07-18.
> Research / SWE-bench / EPB are internal Default-Off tracks and are **not** Public Release marketing.

---

## What is MOGU AI?

MOGU AI is a Windows personal AI control center: chat-first Agent, OpenClaw/PAI runtimes, nine Skills, ComfyUI Studio, model downloads, permissions, tasks, data backup/diagnostics, and a coding factory. Online models are optional; local tools stay on your machine.

<p align="center">
  <img src="docs/images/01-home-v153.png" width="900" alt="MOGU AI home" />
</p>

---

## What's included

### Agent and runtimes

- Chat-first home with explicit executor choice: Brain / OpenClaw / PAI
- No silent fallback unless the user enables OpenClaw→PAI fallback
- Permission levels L1/L2/L3 with audit; L3 always reconfirms
- Task center, backup/restore (no secrets), diagnostic export

### Agent models

- Browse, search, and download GGUF models
- Import completed downloads into Ollama for offline use
- Manage downloaded models and active downloads
- Guidance model: built-in tutorial, local Ollama, or online API
- Online presets for DeepSeek, OpenAI, Qwen, Kimi, and custom OpenAI-compatible endpoints

<p align="center">
  <img src="docs/images/02-agent-models-v153.png" width="900" alt="Agent models" />
</p>

### Local Agent

- Open ComfyUI, list workflows, search files, and back up projects with natural language
- Ask how to install the environment or use Studio
- PAI permission levels and confirmation for risky operations
- Scheduled shutdown for long generation jobs

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

- Choose AI executor (OpenClaw / PAI / Brain)
- Check and start Ollama
- Install, select, and connect PAI
- Scan for an existing ComfyUI installation
- Install portable FFmpeg without manual PATH setup

<p align="center">
  <img src="docs/images/06-setup-v153.png" width="900" alt="Environment setup" />
</p>

---

## Download and install

Public customers should only install packages from [mogu-ai-releases](https://github.com/ly136148277-netizen/mogu-ai-releases/releases/latest) after Public RC hard gates pass. Until then, local `dist` builds are **Internal Preview / unsigned**.

Typical filenames (version follows `package.json`):

- Installer: `MOGU-AI-Setup-<version>.exe` (NSIS)
- Portable: electron-builder portable EXE (**免安装版** — same AppData as the installer; **not** a self-contained data profile beside the EXE)

1. Download from Releases
2. Run the installer (or portable EXE)
3. On first launch open Environment, choose an executor, then configure Ollama / PAI / ComfyUI / FFmpeg as needed

### Data and privacy facts

- User data lives under `%APPDATA%\ai-model-manager\` (same for NSIS and Portable)
- Uninstall **keeps** AppData by default (`deleteAppDataOnUninstall: false`)
- API keys use Electron `safeStorage` only (fail-closed; never plaintext)
- Clean-profile QA: `MOGU_USER_DATA=<empty dir>` or `--user-data-dir=` — do not delete the developer profile

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
npm ci
npm test
npm start
```

Release / packaging notes: [`docs/RELEASE.md`](./docs/RELEASE.md) · Code signing policy: [`docs/CODE_SIGNING_POLICY.md`](./docs/CODE_SIGNING_POLICY.md) · Public RC freeze: [`docs/PUBLIC_RELEASE_FINAL_FREEZE.md`](./docs/PUBLIC_RELEASE_FINAL_FREEZE.md)

---

## License

MIT — see [LICENSE](./LICENSE).

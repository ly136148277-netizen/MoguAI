# MOGU AI 1.5.3

[English](./README.md) | **简体中文**

<p align="center">
  <img src="assets/icon.png" width="112" alt="MOGU AI" />
</p>

<p align="center">
  <strong>Agent 模型 · 本机 Agent · ComfyUI 创作 · 视频合成</strong><br>
  <sub>面向 Windows 的开源本地 AI 创作桌面应用。模型和作品留在自己的电脑。</sub>
</p>

<p align="center">
  <a href="https://github.com/ly136148277-netizen/mogu-ai-releases/releases/latest"><strong>下载最新版</strong></a>
  ·
  <a href="./docs/STUDIO_v1.5.md">创作台文档</a>
  ·
  <a href="./docs/SETUP_HUB_v1.5.md">环境安装</a>
  ·
  <a href="https://github.com/ly136148277-netizen/MoguAI/issues">反馈问题</a>
</p>

[![Release](https://img.shields.io/github/v/release/ly136148277-netizen/mogu-ai-releases?label=下载&sort=semver&color=0078D6)](https://github.com/ly136148277-netizen/mogu-ai-releases/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6)](https://github.com/ly136148277-netizen/MoguAI)
[![Version](https://img.shields.io/badge/version-1.5.3-22c55e)](https://github.com/ly136148277-netizen/mogu-ai-releases/releases/tag/v1.5.3)

---

## MOGU AI 是什么

MOGU AI 把本地模型、电脑 Agent、ComfyUI 工作流和视频拼接放进一个桌面窗口。你可以下载 Agent 模型、让 Agent 操作本机、导入自己的 ComfyUI 工作流生成图片或视频，再把多个短镜头按时间线拼成长片。

它不是云端生成网站。Ollama、PAI、ComfyUI 和 FFmpeg 都运行在本机；是否使用联网模型由你自己决定。

<p align="center">
  <img src="docs/images/01-home-v153.png" width="900" alt="MOGU AI 1.5.3 首页" />
</p>

---

## 当前版本包含什么

### Agent 模型

- 浏览、搜索并下载 GGUF 模型
- 下载完成后导入 Ollama，在本机离线使用
- 管理已下载模型和下载任务
- Agent 引导模型可选内置教程、本机 Ollama 或联网 API
- 联网 API 支持 DeepSeek、OpenAI、通义千问、Kimi 和自定义 OpenAI 兼容地址

<p align="center">
  <img src="docs/images/02-agent-models-v153.png" width="900" alt="Agent 模型页面" />
</p>

### 本机 Agent

- 用自然语言打开 ComfyUI、列出工作流、搜索文件和备份项目
- 询问 MOGU AI、环境安装和创作台的使用方法
- PAI 分级权限与危险操作确认
- 定时关机，适合长时间生成任务
- 办事走本机 PAI；引导和答疑可选内置、本地或联网模型

<p align="center">
  <img src="docs/images/03-agent-v153.png" width="900" alt="MOGU AI Agent 页面" />
</p>

### ComfyUI 创作台

- 导入自己的文生图和图生视频工作流
- 分开填写人物描述与动作描述
- 选择分辨率、清晰度和视频时长
- 尽量把提示词及参数写入兼容的 ComfyUI API 工作流
- 文生图成品可继续传给图生视频阶段
- 显示进度和输出预览，可中断任务并清空队列

优先使用 ComfyUI 的 **Save (API Format)**。工作流必须与任务和模型适配；特殊节点或特殊连线可能无法自动覆盖参数。

<p align="center">
  <img src="docs/images/04-studio-v153.png" width="900" alt="ComfyUI 创作台" />
</p>

### 视频合成

- 多个短视频按时间线排序
- FFmpeg 一键首尾拼接成长视频
- 首次使用自动准备 FFmpeg
- 合成结果直接预览
- 打开 Shotcut、剪映或自定义工具继续细修

<p align="center">
  <img src="docs/images/05-compose-v153.png" width="900" alt="视频合成时间线" />
</p>

### 一键环境

- 检查和启动 Ollama
- 安装、选择并连接 PAI
- 扫描本机 ComfyUI
- 安装便携 FFmpeg，无需手动配置 PATH
- 首页与创作台显示四项环境状态

<p align="center">
  <img src="docs/images/06-setup-v153.png" width="900" alt="一键环境页面" />
</p>

---

## 下载与安装

推荐下载 **`MOGU-AI-Setup-1.5.3.exe`**：

1. 从 [Releases](https://github.com/ly136148277-netizen/mogu-ai-releases/releases/latest) 下载安装包
2. 双击运行并选择安装位置
3. 确认安装；完成后桌面会自动创建圆形蘑菇快捷方式
4. 首次打开进入「环境」，按需要配置 Ollama、PAI、ComfyUI 和 FFmpeg

便携版文件为 **`MOGU.AI.1.5.3.exe`**，无需安装即可运行。`latest.yml` 和 `.blockmap` 仅用于应用内自动更新。

### 运行环境

- Windows 10 / 11，64 位
- MOGU AI 本体约 300 MB 可用空间
- 本地模型通常需要额外数 GB 空间
- 本地模型和聊天需要 [Ollama](https://ollama.com/)
- ComfyUI 创作需要 PAI 与 ComfyUI
- 视频拼接需要 FFmpeg，可在软件内安装

---

## ComfyUI 工作流

把工作流 JSON 放进以下任一位置：

- 推荐：`{PAI根目录}/workflows/`
- ComfyUI 默认目录：`{ComfyUI}/ComfyUI/user/default/workflows/`

然后进入「ComfyUI创作」，选择工作流并填写参数。GGUF Agent 模型库和 ComfyUI 工作流是两套独立目录，请勿混用。

详细说明见 [`docs/COMFYUI_WORKFLOWS.md`](./docs/COMFYUI_WORKFLOWS.md) 和 [`docs/STUDIO_v1.5.md`](./docs/STUDIO_v1.5.md)。

---

## 开发

```bash
git clone https://github.com/ly136148277-netizen/MoguAI.git
cd MoguAI
npm install
npm start

npm test          # 运行测试
npm run screenshots
npm run dist      # 构建 Windows 安装版与便携版
```

### 架构

```text
Electron
├── Agent 模型  → GGUF 下载 / Ollama / 联网 API
├── Agent       → PAI HTTP / 本机能力
├── 创作台      → PAI Studio / ComfyUI 工作流
├── 视频合成    → FFmpeg / 外部剪辑工具
└── 环境中心    → Ollama / PAI / ComfyUI / FFmpeg
```

### 相关仓库

- [`MoguAI`](https://github.com/ly136148277-netizen/MoguAI)：Electron 源码
- [`mogu-ai-releases`](https://github.com/ly136148277-netizen/mogu-ai-releases)：安装包与自动更新文件
- [`mogu-map`](https://github.com/ly136148277-netizen/mogu-map)：GGUF 模型库 CDN

发版说明见 [`docs/RELEASE.md`](./docs/RELEASE.md)，贡献方式见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

---

## 许可证

[MIT](./LICENSE) — 可用于个人和商业项目。

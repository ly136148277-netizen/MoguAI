# 蘑菇AI · Mogu AI

[English](./README.md) | **简体中文**

> 一款桌面应用：**GGUF 模型下载**、**Ollama 离线聊天**、可选 **AI 执行管家** —— 无需命令行。

[![Release](https://img.shields.io/github/v/release/ly136148277-netizen/mogu-ai-releases?label=下载&sort=semver)](https://github.com/ly136148277-netizen/mogu-ai-releases/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6)](https://github.com/ly136148277-netizen/MoguAI)

<p align="center">
  <strong>模型仓库 · 下载中心 · 我的模型 · AI 聊天 · 执行管家</strong>
</p>

---

## 为什么用蘑菇AI？

| 痛点 | 蘑菇AI |
|------|--------|
| HuggingFace 找 GGUF 麻烦 | 内置模型库 + CDN 在线更新（8+ 模型） |
| 手写 Modelfile / ollama create | 下载后自动导入 Ollama |
| 聊天工具分散 | 内置多会话聊天 + Markdown 导出 |
| 电脑自动化（可选） | PAI 管家：ComfyUI 出片、搜文件、备份等 |

基于 **Electron 35**，模型下载后可**完全离线**使用，数据留在本机。

---

## 功能一览

- **模型仓库** — 搜索、标签、收藏、CDN 同步
- **下载中心** — 多线程、断点续传、SHA256 校验、镜像（官方 / HF Mirror）
- **我的模型** — 状态管理、重新导入、打开目录、删除
- **AI 聊天** — 流式回复、Markdown、Prompt 模板、会话导出
- **AI 执行管家**（可选）— PAI 对接、ComfyUI 出片面板、L1/L2/L3 权限
- **中英双语** 界面
- **自动更新** — GitHub Releases（Windows）

**预置模型（8 个）：** Llama 3 8B、Qwen 2.5 7B/3B、Phi-3 Mini、Gemma 2 2B、DeepSeek R1 Distill 7B、Mistral 7B v0.3、Nomic Embed v1.5

**依赖：** 需安装 [Ollama](https://ollama.com/) · 管家功能需本机 [PAI](https://github.com/)（可选）

---

## 下载（Windows）

👉 **[发布页 — mogu-ai-releases](https://github.com/ly136148277-netizen/mogu-ai-releases/releases/latest)**

| 文件 | 说明 |
|------|------|
| `蘑菇AI Setup x.y.z.exe` | 安装版 |
| `蘑菇AI x.y.z.exe` | 便携版 |

---

## 源码运行

```bash
git clone https://github.com/ly136148277-netizen/MoguAI.git
cd MoguAI
npm install
npm start
```

1. 安装并启动 **Ollama**
2. 打开 **模型仓库** → 下载模型
3. 自动导入后 → **开始聊天**

```bash
npm test      # 50 项测试
npm run dist  # 打包 Windows 安装程序
```

---

## 架构

```
Electron 壳
├── AI 聊天    → Ollama
├── 模型管理   → GGUF 下载 / 存储 / CDN
└── 执行管家   → PAI HTTP（可选）
```

发版、模型 CDN、签名说明见 [`docs/RELEASE.md`](./docs/RELEASE.md)。

---

## 参与贡献

欢迎 PR！详见 [CONTRIBUTING.md](./CONTRIBUTING.md) · 问题反馈请开 [Issue](https://github.com/ly136148277-netizen/MoguAI/issues)。

**请勿提交密钥**（`config/github.token`、个人 Token 等）。

---

## 许可证

[MIT](./LICENSE) — 可自由用于个人与商业项目。

---

<p align="center">
  如果这个项目对你有帮助，欢迎 ⭐ Star，能让更多人发现它。
</p>

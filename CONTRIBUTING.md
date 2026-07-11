# Contributing · 参与贡献

**English** | [简体中文](#简体中文)

Thank you for improving **Mogu AI**! This guide explains how to set up, what to change, and where **not** to touch without coordinating.

Docs: [README](./README.md) · [README 中文](./README.zh-CN.md) · [ComfyUI workflows](./docs/COMFYUI_WORKFLOWS.md)

---

## Who should contribute what?

| Area | Examples | Owner |
|------|----------|--------|
| **Desktop core** | Chat, downloads, Ollama, models CDN, updater, branding | This repo — welcome PRs |
| **Butler / ComfyUI UI** | `butler.js`, `comfyui-panel.js`, `butler-risk.js` | Coordinate via issues first |
| **PAI backend** | `E:\projects\PAI\` routes, workflow scan | Separate PAI project |

**Two catalogs — do not mix:**

| Catalog | Location | Purpose |
|---------|----------|---------|
| GGUF models | `catalog/models.json` | Ollama chat downloads |
| ComfyUI workflows | PAI `/workflows/catalog` | Render pipelines |

---

## Development setup

**Requirements:** Node.js 18+, Windows (primary), [Ollama](https://ollama.com/) for chat/import tests, [PAI](https://github.com/) optional for butler smoke.

```bash
git clone https://github.com/ly136148277-netizen/MoguAI.git
cd MoguAI
npm install
npm start
npm test
```

| Command | Purpose |
|---------|---------|
| `npm start` | Run Electron app |
| `npm test` | 50 unit tests |
| `npm run dist` | Windows installer |
| `npm run screenshots` | Regenerate `docs/images/*.png` for README |

Related repos:

| Repo | Role |
|------|------|
| [MoguAI](https://github.com/ly136148277-netizen/MoguAI) | Source (here) |
| [mogu-ai-releases](https://github.com/ly136148277-netizen/mogu-ai-releases) | Installers |
| [mogu-map](https://github.com/ly136148277-netizen/mogu-map) | GGUF catalog CDN |

---

## Pull requests

1. **Fork** and branch from `master` (`feat/…`, `fix/…`).
2. **One topic per PR** — easier review, faster merge.
3. Run **`npm test`** — all 50 tests must pass.
4. Update **README** (EN + ZH) if user-facing behavior changes.
5. **Never commit secrets** — `config/github.token`, PushPlus tokens, personal keys. See `.gitignore`.
6. Issues & PR descriptions: **English or 中文** — both fine.

### Code style

- Match existing **vanilla JS** in `src/main/` and `src/renderer/`.
- Reuse helpers; avoid new frameworks.
- Comments only for non-obvious business logic.
- Keep IPC handlers in `main.js` grouped; don’t break butler/chat boundaries.

### Before you open a PR

- [ ] `npm test` passes  
- [ ] No secrets or local-only paths committed  
- [ ] README updated if UX changed  
- [ ] Butler-owned files untouched *or* discussed in an issue first  

---

## Reporting bugs

Open a [GitHub Issue](https://github.com/ly136148277-netizen/MoguAI/issues) (templates available) with:

- **Version** — Settings → About / 设置 → 关于  
- **Windows version**  
- **Steps to reproduce**  
- **Expected vs actual**  
- **Logs** (if relevant): `%APPDATA%\ai-model-manager\logs`  

For **ComfyUI / butler** issues, also note PAI root, ComfyUI URL, and whether workflow sync was refreshed. See [`docs/BUTLER_SMOKE.md`](./docs/BUTLER_SMOKE.md).

---

## License

By contributing, you agree your work is licensed under the [MIT License](./LICENSE).

---

## 简体中文

感谢你愿意改进 **蘑菇AI**！本文说明如何参与、改哪里、哪些区域需要先沟通。

### 分工一览

| 范围 | 示例 | 说明 |
|------|------|------|
| **桌面核心** | 聊天、下载、Ollama、CDN、自动更新 | 本仓库，欢迎 PR |
| **管家 / ComfyUI 界面** | `butler.js`、`comfyui-panel.js` | 建议先开 Issue 再改 |
| **PAI 后端** | 工作流扫描、API 路由 | 独立 PAI 项目 |

**两套 catalog 不要混：** GGUF 模型库（`catalog/models.json`）≠ ComfyUI 工作流（`/workflows/catalog`）。

### 环境

```bash
git clone https://github.com/ly136148277-netizen/MoguAI.git
cd MoguAI
npm install && npm start && npm test
```

依赖：Node 18+、Windows、[Ollama](https://ollama.com/)（聊天测试）、PAI（可选，管家测试）。

### 提交 PR 请注意

1. 从 `master` 拉分支，**一个 PR 只做一件事**  
2. **`npm test` 50 项全过**  
3. 用户可见改动请同步 **README 中英文**  
4. **不要提交密钥**（`config/github.token` 等）  
5. Issue / PR 可用中文或英文  

### 报告 Bug

请开 [Issue](https://github.com/ly136148277-netizen/MoguAI/issues)，附上版本、系统、复现步骤、期望与实际结果；日志见 `%APPDATA%\ai-model-manager\logs`。

ComfyUI / 管家问题另请说明 PAI 根目录、ComfyUI 地址、是否已「刷新列表」。详见 [`docs/COMFYUI_WORKFLOWS.md`](./docs/COMFYUI_WORKFLOWS.md)。

### 许可证

贡献即表示同意以 [MIT](./LICENSE) 授权。

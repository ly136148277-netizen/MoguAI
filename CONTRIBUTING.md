# Contributing / 参与贡献

Thank you for helping improve Mogu AI! / 感谢你愿意改进蘑菇AI！

## Languages / 语言

- **README:** [English](./README.md) · [简体中文](./README.zh-CN.md)
- **Issues & PRs:** English or 中文 — both welcome.

## Development setup / 开发环境

```bash
git clone https://github.com/ly136148277-netizen/MoguAI.git
cd MoguAI
npm install
npm start
npm test
```

**Requirements / 依赖:** Node.js 18+, Windows (primary target), Ollama for chat/import tests.

## Pull requests / 提交 PR

1. Fork the repo and create a feature branch.
2. Keep changes focused — one feature or fix per PR.
3. Run `npm test` before submitting (50 tests should pass).
4. Update README if user-facing behavior changes.
5. **Never commit secrets** — especially `config/github.token`, personal tokens, or local-only config.

## Code style / 代码风格

- Match existing patterns in `src/main/` and `src/renderer/`.
- Vanilla JS (no React/Vue) — keep UI changes in renderer modules.
- Comments only for non-obvious logic.

## Reporting bugs / 报告问题

Use [GitHub Issues](https://github.com/ly136148277-netizen/MoguAI/issues) and include:

- Mogu AI version (Settings → About / 设置 → 关于)
- Windows version
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs from `%APPDATA%\ai-model-manager\logs` if applicable

## Scope / 范围说明

This repo is the **desktop app** only. Related repos:

| Repo | Purpose |
|------|---------|
| [mogu-ai-releases](https://github.com/ly136148277-netizen/mogu-ai-releases) | Windows installers |
| [mogu-map](https://github.com/ly136148277-netizen/mogu-map) | Model catalog CDN |

## License / 许可证

By contributing, you agree your contributions are licensed under the [MIT License](./LICENSE).

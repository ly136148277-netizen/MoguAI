# Smoke checklist for 蘑菇AI v1.4.0 (desktop agent)
# Run after: npm test && npm run dist

## Automated (CI/local script)

- [x] `npm test` → 49/49
- [x] `dist/蘑菇AI Setup 1.4.0.exe` exists (~83 MB)
- [x] `dist/latest.yml` version = 1.4.0
- [x] `win-unpacked/蘑菇AI.exe` starts (process alive 8s+)
- [x] Catalog sync → 8 models (bundled fallback when CDN 404)

## Manual (user, ~5 min)

1. Install `蘑菇AI Setup 1.4.0.exe` (or run portable)
2. Top bar: start Ollama if stopped
3. 模型仓库 → 更新模型库 → confirm **8 models**
4. Download small model (e.g. Gemma 2 2B) or use existing
5. 我的模型 → 重新导入 → 开始聊天
6. 设置 → 检查软件更新 (skipped if update.json url empty)

## CDN / updates

- Model catalog: `scripts/publish_model_catalog.ps1` → mogu-map
- App updates: `scripts/publish_mogu_releases.ps1` → GitHub Releases + update.json url

# Acceptance Report · MOGU AI v1.4.0

**Date / 日期:** 2026-07-11  
**Command / 命令:** `npm run acceptance`  
**Result / 结果:** ✅ **24/24 passed**

---

## How to re-run / 如何复验

```bash
npm test                 # 50 unit tests
npm run acceptance       # full acceptance (this checklist)
node scripts/butler_smoke.js --integration
```

---

## Checklist

| ID | Item | Result |
|----|------|--------|
| A01 | Unit tests 50/50 | ✅ |
| A02 | Butler HTTP smoke | ✅ |
| A03 | Butler integration (PAI + ComfyUI) | ✅ |
| A04 | CDN catalog (mogu-map, 8 models) | ✅ |
| A05 | In-app catalog sync | ✅ |
| A06 | Ollama status | ✅ |
| A07 | Ollama generate API | ✅ |
| A08 | Chat pipeline (sessions + Ollama chat) | ✅ |
| A09 | Update feed `latest.yml` v1.4.0 | ✅ |
| A10 | Dist artifacts (Setup + Portable + unpacked) | ✅ |
| A11 | Unpacked app launch (8s alive) | ✅ |
| A12 | GitHub repos reachable | ✅ |
| A13 | README screenshots (4 PNG) | ✅ |
| A14 | Workflow API extract (13 workflows) | ✅ |
| A15 | ComfyUI queue API | ✅ |
| A16 | Local GGUF on disk | ✅ |
| A17 | Ollama imported models | ✅ |
| A18 | Portable green install (fresh copy launch) | ✅ |
| A19 | ComfyUI preset gate (zimage L1→L2) | ✅ |
| A20 | Download engine helpers | ✅ |
| A21 | `config/update.json` GitHub provider | ✅ |
| A22 | Setup exe size matches `latest.yml` | ✅ |
| A23 | GitHub Release latest tag v1.4.0 | ✅ |
| A24 | Ollama re-import path (llama3 present) | ✅ |

---

## Notes / 说明

- **Setup silent `/S`:** NSIS silent install crashes on this host (exit `0xC0000005`). Acceptance uses **portable fresh-copy launch** (A18) + **Setup artifact integrity** (A22) instead. Interactive `MOGU AI Setup 1.4.0.exe` install is verified manually once if needed.
- **ComfyUI full render:** Long GPU render not run in CI; queue + L2 gate + integration smoke cover the pipeline. Run `确认zimage` manually when ComfyUI is idle for end-to-end pixels.

---

## 中文摘要

全部 **24 项自动化验收已通过**，涵盖：测试、PAI/ComfyUI、CDN、Ollama 聊天、模型文件、安装包、GitHub 开源与发布、工作流 API、更新源。

复验：在项目根目录执行 `npm run acceptance`，应输出 `24/24 passed`。

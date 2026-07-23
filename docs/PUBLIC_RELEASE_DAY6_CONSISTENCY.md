# Day 6 — Public RC 一致性（Grok G1）

```yaml
date: 2026-07-23
assignee: Cursor Grok 4.5
status: PASS (docs aligned; SemVer resolved by public release evidence)
```

## 已对齐事实

| 项 | 代码/配置事实 | 文档处置 |
|----|---------------|----------|
| 版本 | `v2.0.0` 已公开发布 | `package.json` / README / SECURITY → `2.0.1-rc.1` |
| Portable | 与 NSIS 共用 AppData | 明确「免安装版」≠ 自包含数据 |
| 卸载 | `deleteAppDataOnUninstall: false` | README / SECURITY / RELEASE 写明保留 |
| Key | safeStorage fail-closed | SECURITY / README |
| 路由 | 显式选择；fallback 默认 false | README / SECURITY |
| 宿主 Key | 默认不继承 | SECURITY |
| 研究轨 | Default-Off | README 明确不进营销 |
| RC SemVer | GitHub API：`v2.0.0` 非 draft、非 prerelease，发布于 2026-07-18 | **RESOLVED** → `2.0.1-rc.1` |

## 未改

- 未创建 commit/tag/push
- 未改 `appId`
- 截图文件名仍带 v153（历史素材）；正文已不再宣称 1.5.3 为当前版本

## 负责人待决

1. 更新截图素材（可选，不阻塞 unsigned preview）
2. 最终签名、Installed Runtime E2E 与上传回验

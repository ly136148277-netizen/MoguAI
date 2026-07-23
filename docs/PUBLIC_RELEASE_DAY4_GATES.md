# Day 4 — 自动门禁与安全

```yaml
date: 2026-07-23
status: COMPLETE (gates green · sandbox deferred with compensating controls)
authority: docs/PUBLIC_RELEASE_FINAL_FREEZE.md
```

## 自动测试

| 门禁 | 结果 |
|------|------|
| `npm test` | **259/259 PASS** |
| `acceptance:v2.0` | **17/17 PASS**（含 npm-test） |
| `acceptance:coding` | **23/23 PASS** |

相对旧基线 249/250：路由/Key 修复后全绿，并新增 `agent-routing` 用例。

## Electron 安全

| 控制 | 状态 |
|------|------|
| `contextIsolation: true` | 已有 |
| `nodeIntegration: false` | 已有 |
| CSP meta（index.html） | 已有 |
| `will-navigate` 拦截 + 外链 `openExternal` | **本 Day 已加** |
| `setWindowOpenHandler` deny + 白名单外链 | **本 Day 已加** |
| `sandbox: true` | **Spike：暂不开启** |

### sandbox spike 结论

开启 `webPreferences.sandbox: true` 需验证 preload IPC、`mogu-media`、Monaco worker、`unsafe-eval`（CSP 已允许）全链路。当前补偿控制：隔离 + 无 nodeIntegration + CSP + 导航/弹窗拦截 + 路径白名单（media）+ SecretStore fail-closed + L3 权限门。高风险未补偿项未发现；**不因 sandbox 未开而阻塞 RC**，但 Public Release 证据包须附本威胁评估。

## 编程工人纪律（已有）

默认不改主分支、不自动 commit/push/开 PR（产品行为；验收靠 coding review/accept 流）。

## 下一阶段

→ Day 5–7 依赖**签名证书**与 `gh auth`。当前无 CSC → 只能打 **Unsigned Internal Preview**，不得称 Public Release。
可先做：文档一致性（Day 6 部分）、预演 Payload Manifest 脚本；正式 Release Set 等外部前置。

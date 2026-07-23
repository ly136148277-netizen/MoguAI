# Day 3 — 公共数据隔离

```yaml
date: 2026-07-23
status: COMPLETE (verified + documented)
authority: docs/PUBLIC_RELEASE_FINAL_FREEZE.md
```

## 结论

干净 Profile 与开发者 Profile **可隔离**；NSIS/Portable **共用** `%APPDATA%\ai-model-manager`（本次称「免安装版」，不做 EXE 旁自包含数据）。卸载**默认保留** AppData。密钥走 safeStorage 失败则拒绝明文。备份/诊断包排除 secrets。

## 验证表

| 项 | 结果 |
|----|------|
| 干净 Profile | `MOGU_USER_DATA=<空目录>` 或 `--user-data-dir=`；**禁止**删开发者目录 |
| NSIS | `perMachine: false`（当前用户）· `deleteAppDataOnUninstall: false`（卸载保留数据） |
| Portable | 同 `appId` → 同 AppData；与 NSIS 安装版数据互通（文档须写明） |
| safeStorage | `SecretStore` fail-closed；无加密能力时不写明文 |
| settings.json | 不持久化 `agentApiKey` |
| 备份 `createBackupPack` | 排除 `secrets.json` / token / api keys |
| 诊断 `exportDiagnosticPack` | excludes secrets/tokens/api keys/model weights |
| 导入备份 | 强制 `agentApiKey: ""`，不导入 secrets |

## 干净 Profile 期望空内容

新 `userData` 下首次启动应无：他人会话、TaskStore、Memory、权限授权、最近工作区、创作项目、下载历史、开发者日志。

## 公开文案约束（Day 6 对齐进 README）

- Portable = **免安装版**（非便携自包含数据）
- 卸载后用户数据默认保留于 AppData
- 升级同 `appId` 继承原 userData（本次不改 appId）

## 下一阶段

→ Day 4：自动测试全绿 + Electron 安全门禁（含 sandbox spike）

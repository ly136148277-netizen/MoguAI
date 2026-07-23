# Phase 0 — 事实验证记录

```yaml
date: 2026-07-23
status: COMPLETE
authority: docs/PUBLIC_RELEASE_FINAL_FREEZE.md
```

## 1. 路由复现（已确认 · 已修）

**触发条件：** 默认 `agentBrainChannel=builtin` + `agentRuntimeMode=openclaw`，大脑 `ready=false`。

**旧行为：** `runAgentText` 在检查 OpenClaw 前因 `!brainReady` 提前 return；UI 仍可能显示「本次由：OpenClaw」。

**修复：**

- 新增 `src/shared/agent-routing.js`（显式路由 · 无静默降级）
- `agent-panel.js` 按 `decideAgentRoute` 分流
- `openclawFallbackToPai` 默认改为 `false`；主进程/UI 改为 `=== true` 才降级
- `builtin` ≠ 未配置：不再拦死 OpenClaw/PAI

**验证：** `node --test tests/agent-routing.test.js` 全绿。

## 2. 干净 Profile 机制（已跑通）

| 方式 | 说明 |
|------|------|
| Electron 原生 | `--user-data-dir=<空目录>` |
| 脚本别名 | 环境变量 `MOGU_USER_DATA=<空目录>`（`main.js` 启动前 `app.setPath`） |

**禁止**删除或迁移开发者 `%APPDATA%\ai-model-manager`。

**Portable 事实：** NSIS 与 Portable 均使用同一 `appId` 下的 AppData；本次称「免安装版」，不做随 EXE 自包含数据。

## 3. Key 继承根因（已定语义）

| 判定 | 结论 |
|------|------|
| 测试失败根因 | 宿主 Shell `OPENAI_API_KEY` 污染，非产品断言过严 |
| 产品语义 | Public：仅 MOGU 显式注入（参数 / `settings.agentApiKey`）计为 `hasKey` |
| 宿主 env | 默认不继承；开发可设 `MOGU_ALLOW_HOST_API_KEY=1` |

**验证：** `tests/coding-skill.test.js` 隔离后通过。

## 4. 签名 / 更新前置（外部硬门）

| 项 | 状态 |
|----|------|
| `CSC_LINK` / 证书 | **未配置** |
| `signAndEditExecutable` | `false` |
| `gh auth` | **未登录** |
| 更新源 | `config/update.json` → `mogu-ai-releases` |
| 产品版本 | `package.json` = `2.0.0` |

**结论：** 证书与 Release 写权限恢复前，发行终点只能是 **Unsigned / Internal Preview**，不得称 Public Release。

## 5. Public Build Profile 初稿（冻结输入）

**必须打进包：**

- `config/moguai-runtime-compat.json`（已加入 `package.json` → `build.files`，P0）
- prompts / repository / update / skills-whitelist

**必须排除：** `*.token`、`.env`、`secrets.json`、`config/mogu_*.json`、`config/xuzhou_*.json`、scripts/

**运行时 Default-Off：** 研究开关不进营销；不依赖可修改 JSON  alone。

## 下一阶段

→ Day 1：`audit-public-inputs`（个人绑定、私人依赖、白名单全量审计报告）

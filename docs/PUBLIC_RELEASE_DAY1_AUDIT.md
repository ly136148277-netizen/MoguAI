# Day 1 — 个人绑定与构建输入审计

```yaml
date: 2026-07-23
status: COMPLETE (fixes applied for P0/P1)
authority: docs/PUBLIC_RELEASE_FINAL_FREEZE.md
next: Day 2 fix-first-run
```

## 结论摘要

仓库内**未发现**可提交的真实 API Token / PAT / 私钥。主要风险是**开发者路径作为 UI/扫描默认值**，以及发布通道依赖外部凭据。已修 P0；Public Build Profile 见文末。

## 1. 凭据与密钥

| 项 | 结果 |
|----|------|
| `sk-…` / `ghp_` / `github_pat_` in src/config | **未命中** |
| `config/github.token` | 不存在（仅有 `.example`） |
| `secrets.json` in repo | 不存在 |
| `settings.js` 持久化 | `agentApiKey` 保存前强制清空 → SecretStore |
| 宿主 `OPENAI_API_KEY` | Phase 0 已改为默认不继承 |

**残留示例（允许保留，禁止实填）：** `config/signing.example.env`、`config/github.token.example`

## 2. 个人 / 开发者路径

| 位置 | 问题 | 处置 |
|------|------|------|
| `src/renderer/renderer.js` | `paiRoot \|\| "E:\\projects\\PAI"` 把开发者路径写进表单 | **P0 已修** → 空串 |
| `src/renderer/index.html` | placeholder `E:\projects\PAI` | **已改**中性文案 |
| `src/main/mcp-presets.js` | 预设 `D:\\safe-folder` | **已改** `REPLACE_WITH_SAFE_FOLDER` |
| `src/main/settings.js` 注释 | 示例含 `D:\\` | **已改** |
| `src/main/setup-hub.js` `findExistingPaiRoots` | 扫描 `D:\projects\PAI` 等 | **保留为启发式发现**（非默认写入）；公共文档注明 |
| `src/main/env-scan.js` | `D:\ComfyUI`… | **保留为常见安装位扫描** |

## 3. 私人依赖与默认服务

| 项 | 公共是否可接受 | 说明 |
|----|----------------|------|
| `paiApiUrl` `127.0.0.1:8765` | 是 | 本机环回 |
| `openclawGatewayUrl` `ws://127.0.0.1:18789` | 是 | 本机环回 |
| `agentApiPreset=deepseek` + 公开 Base URL | 条件接受 | 无内置 Key；用户可选改 |
| `config/update.json` owner `ly136148277-netizen` / `mogu-ai-releases` | 是（产品通道） | 非个人密钥 |
| `config/repository.json` mogu-map CDN | 是 | 公开模型目录 |
| `config/xuzhou_*.json` | **不得进包** | 已在 `build.files` 与 asar-denylist 排除 |
| 研究 / SWE-bench / EPB | Default-Off | 不进营销；scripts 不进包 |

## 4. 打包白名单 vs 仓库文件

**`package.json` → `build.files` 允许：**

- `src/**`、`skills/**`、`catalog/**`、图标、`models.json`、`package.json`
- `config/prompts.json`、`repository.json`、`update.json`、`skills-whitelist.json`
- `config/moguai-runtime-compat.json`（Phase 0 已补）

**明确排除：** `*.token`、`.env*`、`secrets.json`、`config/mogu_*.json`、`config/xuzhou_*.json`、`scripts/**`

**afterPack：** `assertResourcesClean` 二次拦 denylist。

**仓库仍存在但不进包：** `config/xuzhou_districts.json`、`config/xuzhou_pois.json`（本地/地图用途）。

## 5. Electron 安全基线（预览 · Day 4 闭环）

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox`：未开（Day 4 spike）

## 6. 签名 / 发布通道（仍为外部硬门）

- `CSC_*` 未配置 · `signAndEditExecutable: false`
- `gh auth` 未登录
- → 终点 **Unsigned / Internal Preview** 直至恢复

## Public Build Profile v1（冻结）

```text
PROFILE_ID: mogu-public-win-x64-v1
INCLUDE:
  - Electron app (src, skills, catalog, assets icons)
  - Public config: prompts, repository, update, skills-whitelist, moguai-runtime-compat
  - monaco-editor min bundle (as listed)
EXCLUDE_ALWAYS:
  - tokens, env, secrets, mogu_*, xuzhou_*, scripts/, research run artifacts
RUNTIME_DEFAULTS:
  - agentBrainChannel: builtin
  - agentRuntimeMode: openclaw
  - openclawFallbackToPai: false
  - paiRoot: "" (discover / user-data pai; never E:\projects\PAI)
  - no host OPENAI_API_KEY inheritance unless MOGU_ALLOW_HOST_API_KEY=1
  - research/SWE/EPB: not shipped as product entry
SIGNING: required for Public Release; else Internal Preview only
APP_ID: com.aimodel.manager (no change without upgrade assessment)
```

## 已应用代码修复（本 Day）

1. 设置页不再回填 `E:\projects\PAI`
2. PAI root placeholder 中性化
3. MCP filesystem 预设路径去个人化

## 下一阶段

→ Day 2：首次使用与显式路由 E2E（Setup Wizard、执行方不可用提示、第一条安全任务）

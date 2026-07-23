# Cursor Grok 4.5 任务书 — MOGU 2.0 Public RC

```yaml
assignee: Cursor Grok 4.5
status: READY · awaiting user dispatch
scope: Public RC Day 5–7 preparation that needs no owner credentials
authority:
  - docs/MOGU_NORTH_STAR_AND_CAPABILITY_FUSION.md
  - docs/PUBLIC_RELEASE_FINAL_FREEZE.md
handoff_back_to: GPT-5.6 Sol + repository owner
```

## 任务目标

在不引入 2.1 新能力、不使用发布凭据、不改变产品信任边界的前提下，把当前工作区推进到：

> **可供最终负责人复核、签名、创建 clean RC tag、上传并回验的 Public RC 候选状态。**

Public RC 只是当前里程碑。不得把本任务描述为项目完成或“市面最强 Agent”已经实现。

## 开工前必须读取

1. `docs/MOGU_NORTH_STAR_AND_CAPABILITY_FUSION.md`
2. `docs/PUBLIC_RELEASE_FINAL_FREEZE.md`
3. `docs/PUBLIC_RELEASE_PHASE0_FACTS.md`
4. `docs/PUBLIC_RELEASE_DAY1_AUDIT.md`
5. `docs/PUBLIC_RELEASE_DAY2_FIRST_RUN.md`
6. `docs/PUBLIC_RELEASE_DAY3_DATA_ISOLATION.md`
7. `docs/PUBLIC_RELEASE_DAY4_GATES.md`
8. `docs/NIGHTLY_HANDOFF_20260723.md`
9. `package.json`
10. `docs/RELEASE.md`

先检查 `git status`。工作区已有大量用户/研究变更：**不得重置、覆盖、删除或顺手整理无关文件。**

## Grok 可完成的任务

### G1 — Public RC 一致性审计与修复

检查并修复公共文档和产品事实漂移：

- `README.md`、`README.zh-CN.md`
- `CHANGELOG.md`
- `SECURITY.md`
- `ROADMAP.md`
- `docs/ROADMAP_TO_V2.md`
- `docs/RELEASE.md`
- 应用内可见版本/帮助文案

要求：

- 代码事实以 `package.json` 和当前实现为准。
- 明确 Portable 是“免安装版”，与 NSIS 共用 AppData，不承诺数据随 EXE 自包含。
- 明确卸载默认保留用户数据。
- 明确 API Key 仅由 `safeStorage` 保存，失败关闭。
- 明确 OpenClaw/PAI/Brain 为显式选择，不静默降级。
- 研究、SWE-bench、EPB、D1 不进入 Public Release 营销。
- 不擅自决定 RC SemVer：先查公开 Release 证据；无法确认时写成阻塞项，不改版本。

产出：

- 文档修复
- `docs/PUBLIC_RELEASE_DAY6_CONSISTENCY.md`

### G2 — Public Build Profile 自动门禁

实现一个只读检查器，验证：

- `package.json.build.files` 包含公共运行必需文件，尤其 `config/moguai-runtime-compat.json`
- 排除 token、env、secrets、`config/mogu_*`、`config/xuzhou_*`、scripts、研究产物
- 默认配置不含个人绝对路径、真实凭据、私人服务地址
- `openclawFallbackToPai` 默认 `false`
- 不默认继承宿主 `OPENAI_API_KEY`
- 研究能力不存在 Default-On 产品入口

建议文件：

- `scripts/check_public_build_profile.js`
- `tests/public-build-profile.test.js`
- `package.json` 增加 `check:public-profile`

门禁必须 fail-closed，输出具体命中路径和原因，不得自动删除文件。

### G3 — Payload Manifest 生成器

实现可重复运行的 SHA-256 manifest 生成器，覆盖：

- NSIS installer
- Portable EXE
- blockmap
- `latest.yml`（若存在）
- `win-unpacked/resources/app.asar`
- `app.asar.unpacked`
- extraResources、native modules、公开配置和可执行资源

要求：

- 输入目录和输出路径可参数化。
- 递归路径排序稳定。
- 记录相对路径、字节数、SHA-256。
- 禁止把 token、密码或环境值写入 manifest。
- manifest 不对自身做 self-hash。
- 缺少“最终签名”状态时标记 `unsigned/internal-preview`，不得伪装通过。

建议文件：

- `scripts/generate_payload_manifest.js`
- `tests/payload-manifest.test.js`
- `package.json` 增加 `manifest:payload`

### G4 — Release Evidence Manifest 模板与校验器

实现 Evidence Manifest 模板/校验器，字段至少包括：

- tag、commit、clean-tree 状态
- Public Build Profile hash
- lockfile hash
- Payload Manifest hash
- Release Set 各文件名/大小/SHA-256
- 签名与时间戳状态
- Node/npm/Electron/electron-builder 版本
- 测试命令、结果、时间与环境
- Source / Artifact / Installed Runtime Gate 状态
- 上传后下载回验状态

规则：

- Evidence Manifest 不记录自身 hash。
- 未签名、dirty tree、未做安装 E2E 或未上传回验时必须明确 `blocked/pending`。
- 不接触 GitHub，不上传，不签名。

建议文件：

- `scripts/generate_release_evidence.js`
- `scripts/validate_release_evidence.js`
- `tests/release-evidence.test.js`
- `docs/RELEASE_EVIDENCE_SCHEMA.md`

### G5 — Unsigned Internal Preview 构建与静态 Artifact Gate

在不使用证书的前提下：

1. 运行所有现有门禁。
2. 构建 unsigned 候选。
3. 运行 ASAR denylist 与 Public Build Profile 检查。
4. 对构建产物做凭据、个人路径、研究入口和私人默认服务扫描。
5. 生成 Payload Manifest 和 `unsigned/internal-preview` Evidence 草案。

必须使用当前仓库定义的命令，不能跳过失败：

```text
npm test
npm run acceptance:v2.0
npm run acceptance:coding
npm run dist
npm run check:asar
npm run check:public-profile
```

若命令名实际不同，先根据 `package.json` 修正任务记录，不伪造结果。

产出：

- `docs/PUBLIC_RELEASE_ARTIFACT_GATE_DRAFT.md`
- unsigned 构建结果与 hash（构建产物不提交）
- 所有失败项的复现命令和根因

### G6 — 干净 Profile 桌面 E2E 预演

仅使用临时目录：

```text
MOGU_USER_DATA=<temporary empty directory>
```

禁止读取、删除或迁移开发者 `%APPDATA%\ai-model-manager`。

覆盖：

- 首次启动无历史会话/任务/权限/Memory/工作区/日志
- 执行方选择 UI
- 默认 OpenClaw 未连接时不误报“必须先配置大脑”
- PAI 手动切换
- 自动 fallback 默认关闭
- 内置帮助安全任务
- 诊断包和备份不含 secrets/token
- NSIS 与 Portable 数据目录行为记录

如果无法可靠自动化 UI，输出精确手工步骤和证据缺口，不能声明通过。

产出：

- `docs/PUBLIC_RELEASE_DAY5_E2E_DRAFT.md`

### G7 — Capability Intake 矩阵骨架（只研究，不接能力代码）

为 2.1 建立矩阵，但本任务不得引入新 Agent 代码。

候选：

- Cursor
- Trae Agent
- OpenClaw
- Claude Code
- Codex
- Aider
- OpenHands
- Cline / Roo
- Continue

每项记录：

- 一手官方仓库/文档 URL
- 精确版本或 commit
- License 文件与 SPDX（无法确认写 UNKNOWN）
- 候选能力
- 采用方式：依赖 / Adapter / Fork / Clean-room
- 权限、数据、遥测、自动更新、长期状态风险
- 二级依赖/商标/专利/分发待核项
- MOGU 接口位置
- A/B 指标与 Default-On 门槛

不得把法律意见写成已确认事实；不得因为“开源”就推断可商用。

产出：

- `docs/CAPABILITY_INTAKE_MATRIX.md`
- `docs/CAPABILITY_LICENSE_EVIDENCE.md`

## 明确禁止

- 不修改 Cursor 计划文件。
- 不创建 commit、tag、branch、PR 或 push。
- 不登录 GitHub，不上传 Release。
- 不使用、读取或打印任何真实 token、Key、证书或密码。
- 不签名、不生成假签名结果。
- 不改 `appId` / userData 路径。
- 不删除开发者 Profile。
- 不引入 2.1 能力代码或新 Agent 依赖。
- 不自动 commit/push 用户仓库。
- 不把 unsigned 包称为 Public Release。
- 不回滚、覆盖或清理用户已有大量未提交变更。
- 不修改研究结论，不运行被 Gate 禁止的 CT。

## 工作顺序

```text
G1 文档事实
→ G2 Public Profile Gate
→ G3 Payload Manifest
→ G4 Evidence Manifest
→ G5 unsigned Artifact Gate
→ G6 clean-profile E2E draft
→ G7 Capability Intake 矩阵
```

若发现高风险安全问题，停止扩展范围，只修复与 Public RC 直接相关的问题并记录。

## Grok 完工验收

必须提供：

1. 变更文件清单。
2. 每项 G1–G7 的 PASS / BLOCKED / NOT STARTED。
3. 实际运行的命令、退出码和关键结果。
4. 未解决风险与复现方式。
5. 未签名、未上传、未安装回验的明确声明。
6. `git diff --check` 结果。
7. 不声称 Public Release 完成。

## 保留给 GPT-5.6 Sol / 项目所有者

以下任务 Grok 不得代替最终负责人完成：

- 复核 Grok 全部代码、脚本、文档和安全边界。
- 决定 RC SemVer。
- 清理/拆分当前 dirty workspace，形成审阅完成的 release branch。
- 创建 clean RC commit/tag。
- 配置和使用代码签名证书、时间戳服务。
- 验证最终签名后的 EXE、blockmap、`latest.yml` 一致性。
- 最终签名 NSIS/Portable 的 Windows 安装、升级、回滚、卸载 E2E。
- GitHub Release 上传、重新下载、hash/大小/签名回验。
- 最后发布 `latest.yml` 并用真实客户端验证更新。
- 对 Capability Intake 的许可证结论做最终人工/法律复核。
- 批准任何能力 Default-On。
- Public RC 完成后启动 2.1 的 GPT-5.6 同协议 A/B。

## 给 Cursor Grok 4.5 的启动提示词

```text
你负责执行 docs/GROK45_PUBLIC_RC_TASK_BRIEF.md。

先读取该任务书列出的全部权威文档和 git status，再按 G1→G7 顺序工作。
严格遵守禁止项。不要 commit、tag、push、上传、签名、读取凭据、删除用户 Profile，
不要引入 2.1 新能力代码，也不要回滚工作区既有改动。

每完成一项立即运行对应测试并记录真实结果。任何未验证内容必须标记 BLOCKED，
不得推断为 PASS。最终按“Grok 完工验收”格式交付，等待 GPT-5.6 Sol 复核。
```

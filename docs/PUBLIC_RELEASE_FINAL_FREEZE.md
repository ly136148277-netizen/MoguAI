# MOGU AI 公共发行计划 — FINAL FREEZE v1.0

```yaml
status: PAUSED after Day 4 · awaiting explicit "开始"
authority: current milestone under MOGU North Star
research: SWE-bench / EPB / D1 parallel · Default-Off · non-blocking
```

> **上位总纲：** [`MOGU_NORTH_STAR_AND_CAPABILITY_FUSION.md`](./MOGU_NORTH_STAR_AND_CAPABILITY_FUSION.md)
> Public RC 是当前交付里程碑，不是项目终点或 Agent 能力完成。完成后立即进入 **2.1 Agent Capability Fusion**。

## 一句话

把现有 **MOGU AI 2.0 Personal Build** 净化、隔离、加固为普通用户可安全安装的 **Windows Public Release**。不重写产品、不新建代码库、不重造 Runtime。

```text
Personal Build
→ 清除个人绑定 · 隔离用户数据 · 修复公共主路径 · 安全加固
→ Public Release Candidate
→ 全部硬门通过 → Public Release
任一硬门失败 → Internal Preview / RC only
```

## 冻结范围

**保留：** Electron 桌面、9 Skills、对话/任务/权限/创作/模型/数据、OpenClaw、PAI、ComfyUI、Ollama、精密工厂与编程工人。

**本窗口不做：** 重写产品 · 新建仓库 · 重造 Agent Runtime · 新增页面/横向能力 · CLI 作普通用户入口 · 新增遥测 · SWE-bench/EPB 作发布门槛 · 随意改 `appId`/`userData` · 引入新的外部 Agent 能力代码。

本条只冻结七天 Public RC 的变更范围，不取消 2.1–3.0 能力路线。能力候选、开源复用与许可证清单可在本窗口整理，但代码接入须等 Public RC 完成。

**研究轨：** D1 仍 50→条件+50、帽 100；Default-Off；不阻塞、不营销。

## 路由原则（显式选择 · 不静默降级）

```text
用户明确选择执行方且可用 → 使用该执行方
所选不可用 → 说明原因并提供选择 · 不静默切换
尚未选择 → 首次启动引导
用户主动启用自动降级 → 才按确认顺序降级
```

禁止把 `builtin` 当作「未配置」而拦死 OpenClaw/PAI。默认 `agentRuntimeMode=openclaw` 时必须先检查 OpenClaw。

## Phase 0 → Day 1–7

见同目录执行清单与仓库计划板。摘要：

| 阶段 | 内容 |
|------|------|
| **Phase 0** | 路由复现 · 干净 Profile · Key 继承根因 · 证书/更新前置 · Public Build Profile |
| **Day 1** | 个人绑定与构建输入审计 |
| **Day 2** | 首次使用与显式路由 |
| **Day 3** | 公共数据隔离 |
| **Day 4** | 自动门禁与安全（含 sandbox spike） |
| **Day 5** | 最终签名候选干净 E2E |
| **Day 6** | 发行一致性 · Payload/Evidence Manifest · SBOM |
| **Day 7** | clean tag · fresh clone · 三层 Gate · 上传回验 · `latest.yml` 最后发布 |

## 三层 Gate + Release Evidence Binding

- **Source Gate** — clean tag/commit
- **Artifact Gate** — 完整 Payload Manifest（不止 `app.asar`）
- **Installed Runtime Gate** — 最终签名 EXE hash + 环境

第 18 条成立：**只有绑定 clean tag、完整 Payload Manifest、最终签名 Release Set、安装环境与测试时间，并在上传后重新下载验证的证据，才构成公共发布证据。** Blockmap 绑定最终签名文件；Evidence Manifest 不自引用。

## 版本号

- 若 2.0.0 已公开 → `2.0.1-rc.1`
- 若尚未公开 → `2.0.0-rc.1`
计划文档版本 ≠ 产品 SemVer。

## Phase 0 已知事实（审批附件 · 2026-07-23）

1. **路由：** `builtin+openclaw` 下 `runAgentText` 因 `brainReady=false` 提前 return → OpenClaw/PAI 不可达，但 UI 显示「本次由 OpenClaw」。应拆分 `unset` vs 显式 `builtin` 教程。
2. **测试：** `coding-skill` Key 失败为 Shell `OPENAI_API_KEY` 污染；清空后 11/11。需定 `hasKey` = MOGU 显式注入 vs 宿主 env。
3. **打包：** `config/moguai-runtime-compat.json` 未进 `build.files` → Public 包编程引擎升级可能失败（P0）。
4. **Portable：** 与 NSIS 共用 `%APPDATA%\ai-model-manager`；本次称「免安装版」，不做随 EXE 自包含数据。
5. **签名：** 证书/时间戳/Release 写权限为外部前置；不可用则终点 Unsigned/Internal Preview。

### Phase 0 执行结果（2026-07-23 · COMPLETE）

详见 [`PUBLIC_RELEASE_PHASE0_FACTS.md`](./PUBLIC_RELEASE_PHASE0_FACTS.md)。摘要：路由已修；`MOGU_USER_DATA` / `--user-data-dir` 干净 Profile 可用；Key 改为不静默继承宿主 env；compat JSON 已入打包白名单；**证书与 gh 未就绪 → 终点暂限 Internal Preview**。

## 执行授权

```text
2026-07-23 全员同意 → 正式开始 Phase 0
权威存档：本文件
交接：docs/NIGHTLY_HANDOFF_20260723.md
2026-07-23 目标层级修正 → 本文件降为“当前里程碑”；北极星总纲为上位目标
当前暂停点：Day 5–7，等待用户明确“开始”
```

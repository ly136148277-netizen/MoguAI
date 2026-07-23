# Capability Intake Matrix（骨架 · Grok G7）

```yaml
date: 2026-07-23
status: RESEARCH ONLY · no capability code imported
gate: Capability Intake Gate (see north-star doc)
```

> License 列均为待核实。不得因“开源”推断可商用。最终法律结论留给所有者/GPT-5.6 Sol。

| 能力候选 | 来源 | 一手入口（待核） | 版本/commit | License | 采用方式 | MOGU 位置 | 权限/数据风险 | 遥测/更新风险 | A/B 指标 | Default-On |
|----------|------|------------------|-------------|---------|----------|-----------|---------------|---------------|----------|------------|
| 长任务 Runtime / 渠道 / 恢复 | OpenClaw | 官方 Gateway 文档与协议 | 钉扎 protocol（见 OPENCLAW_BRIDGE） | UNKNOWN | Adapter（已用） | Runtime Plane | 高 | 上游更新需钉扎 | 连接稳定性、任务终态正确率 | 条件开启（用户选 OpenClaw） |
| 任务分解 / 多 Agent / 轨迹 | Trae Agent | GitHub `bytedance/trae-agent`（compat 已引用） | compat ref 见 `moguai-runtime-compat.json` | UNKNOWN | Adapter/Fork（引擎 B 适配） | Coding Runtime | 中高 | 上游拉取受适配钉扎 | Resolved@同模型同预算 | OFF until A/B |
| Worktree / 并行 / 验证 | Codex 生态 | `@openai/codex` npm（compat） | adaptedVersion 见 compat | UNKNOWN | Adapter（引擎 A） | Coding Worker | 高 | npm 更新受适配钉扎 | patch+verify 增益 | OFF until A/B |
| Repo Map / 最小 Patch / Git 流 | Aider | 官方仓库待核 | UNKNOWN | UNKNOWN | 依赖/Fork/Clean-room | 代码理解与修改 | 只读→写风险 | 无默认遥测假设 | 定位准确率、patch 体积 | OFF |
| 沙箱 / 事件流 / Benchmark | OpenHands | 官方仓库待核 | UNKNOWN | UNKNOWN | Adapter | Runtime & 评测 | 高 | 可能含远程服务 | 可重放、隔离有效性 | OFF |
| 工具审批 / MCP / 可见轨迹 | Cline / Roo | 各自官方仓库待核 | UNKNOWN | UNKNOWN | Clean-room / 部分依赖 | 权限与交互 | 中高 | 扩展商店/遥测待核 | 误执行率、审批完成率 | OFF |
| Provider / Context Provider | Continue | 官方仓库待核 | UNKNOWN | UNKNOWN | 依赖/Adapter | Brain/Context | 中 | Provider 密钥边界 | 上下文命中率 | OFF |
| IDE Agent 行为（索引/LSP/Diff/后台） | Cursor | 公开产品行为；完整栈不默认开源 | n/a | n/a proprietary | Clean-room only | 精密工厂 | 高 | n/a | 同任务同预算对照 | OFF |
| 终端自主 / 计划-修改-验证 | Claude Code | 公开产品行为 | n/a | n/a proprietary | Clean-room only | Coding Worker | 高 | n/a | 长轨迹成功率 | OFF |

## Intake 下一步（Public RC 后 · 非本任务）

1. 为每一行补齐一手仓库 URL、精确 commit、LICENSE 原文与 SPDX。
2. 扫描二级依赖、商标、专利、遥测端点。
3. 选定采用方式并写行为 Spec。
4. 经 PermissionProxy / TaskStore / Audit 接入后做 GPT-5.6 同协议 A/B。
5. 稳定增益才 Default-On。

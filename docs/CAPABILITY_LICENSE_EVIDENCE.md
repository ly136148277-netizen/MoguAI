# Capability License Evidence Log（Grok G7）

```yaml
date: 2026-07-23
status: INCOMPLETE · evidence collection only
legal_conclusion: NONE — owner/GPT-5.6 Sol must finalize
```

## 方法

- 只记录可核对的公开入口与仓库内已有引用。
- 未下载/未粘贴任何许可证全文时标注 `UNKNOWN`。
- “别人也这么做”不构成许可。

## 条目

### OpenClaw

- 本仓库用法：Adapter（不 fork 进包为内核）
- 证据：`docs/OPENCLAW_BRIDGE.md`、Bridge 实现
- License：UNKNOWN（需对官方发行物/仓库逐条读取）
- 备注：已作为条件开启 Runtime；仍需完整 Notice/商标核对

### Trae Agent（引擎 B 上游候选）

- 仓库内引用：`config/moguai-runtime-compat.json` → `bytedance/trae-agent` ref `e839e55`
- License：UNKNOWN（需在该 commit 读取 LICENSE）
- 采用意图：Adapter/适配钉扎，非盲升

### Codex npm 包（引擎 A 上游候选）

- 仓库内引用：`config/moguai-runtime-compat.json` → `@openai/codex`
- License：UNKNOWN（需查 npm 包与仓库 LICENSE）
- 采用意图：Adapter/适配钉扎

### Aider / OpenHands / Cline / Roo / Continue

- 状态：矩阵已列候选；本任务未取证到一手 LICENSE 文件
- License：UNKNOWN
- 在 Public RC 窗口内禁止引入代码

### Cursor / Claude Code

- 状态：公开产品行为可观察；完整商业栈不默认视为开源
- 采用方式：Clean-room only
- License：proprietary / n/a

## 阻断

在所有者完成许可证终审前，任何候选能力不得 Default-On，也不得在本 Public RC 窗口合入新依赖。

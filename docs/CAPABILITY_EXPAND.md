# 能力扩展（大脑工具对齐 / 搜索 / 浏览器 / MCP / 记忆）

存档点：`archive/brain-coding-2026-07-19`（coding bridge + brain-act）。

## 默认路径

1. **大脑已配置（API / 本机）** → 对话由大脑调度 Skills（优先）
2. 大脑未配置 → 兜底 OpenClaw 或 PAI（设置里「兜底通道」）
3. UI 「本次由：大脑 / OpenClaw / PAI」标明下一条谁执行

## 新增 Skills

| Skill | 作用 |
|-------|------|
| `mogu.search` | DuckDuckGo 搜索，无需单独 Key |
| `mogu.browser` | `open` / `fetch`；可选本机 Playwright |
| `mogu.memory` | 本地 `userData/memory/facts.json` |

## MCP

设置 →「MCP 工具」JSON 数组。启用后大脑工具名：`mcp__{id}__{toolName}`。

## 大脑工具表

`BRAIN_TOOLS` 由 `registry` 的 ops 生成，与 SkillRuntime 对齐（含 `cancel` / `import` / `trajectory` 等）。

## P0 打磨（编程审阅 + 大脑记忆）

- 编程任务卡：文件列表 / diff / 确认提交 / 跑测试；`status` 带可复制安装命令
- 大脑：开聊前自动 `memory.recall`；长对话摘要压缩；步骤条 `agent-brain-steps`

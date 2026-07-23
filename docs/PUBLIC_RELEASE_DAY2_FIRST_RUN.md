# Day 2 — 首次使用与显式路由

```yaml
date: 2026-07-23
status: COMPLETE (code path)
authority: docs/PUBLIC_RELEASE_FINAL_FREEZE.md
depends: Phase 0 routing · Day 1 audit
```

## 目标

复用现有 Setup / 环境灯，不重造 onboarding：用户能选执行方、看可用性、完成第一条安全任务；不可用时说明选项，不静默降级。

## 已落地

| 场景 | 行为 |
|------|------|
| 默认 `builtin + openclaw` | 走 OpenClaw，不再因大脑未配拦截 |
| 显式 `api/local` 未就绪 | `need_setup` + 可选改 OpenClaw/PAI |
| OpenClaw 不可用且未开 fallback | `unavailable` + 明确选项 |
| 用户勾选「失败时回退 PAI」 | 才允许 auto_fallback |
| 欢迎语 | 不再「必须先配大脑」；说明三选一与安全试用 |
| 环境页 | 新增「AI 执行方」卡片：OpenClaw / PAI / 去配大脑 / 去对话试一条 |
| OpenClaw 横幅 | 文案改为「不会静默切换」 |

## 第一条安全任务（手工验收清单）

干净 Profile（`MOGU_USER_DATA` 或 `--user-data-dir`）：

1. 启动 → 环境页可见执行方卡片
2. 对话欢迎语与执行方 pill 一致（默认 OpenClaw）
3. 未连 Gateway 时发送指令：进入 OpenClaw 路径或给出连接/改选提示，**不是**「请先配置大脑」
4. 说「怎么用创作台」→ 内置教程可用
5. 改选 PAI → 设置写入 `agentRuntimeMode=pai`，pill 更新
6. 确认设置里「失败回退 PAI」默认**未勾选**

## 下一阶段

→ Day 3：公共数据隔离（NSIS/Portable、safeStorage、备份脱敏、卸载保留）

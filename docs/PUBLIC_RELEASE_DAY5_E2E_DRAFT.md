# Day 5 — 干净 Profile E2E 草案（Grok G6）

```yaml
date: 2026-07-23
status: BLOCKED/PARTIAL · manual steps only (no signed install E2E)
assignee: Cursor Grok 4.5
```

## 隔离规则

```powershell
$tmp = Join-Path $env:TEMP ("mogu-clean-" + [guid]::NewGuid().ToString("n").Substring(0,8))
New-Item -ItemType Directory -Path $tmp | Out-Null
$env:MOGU_USER_DATA = $tmp
# or: electron . --user-data-dir=$tmp
```

**禁止**读取/删除/迁移 `%APPDATA%\ai-model-manager`。

## 手工步骤与期望

| # | 步骤 | 期望 | 自动化 |
|---|------|------|--------|
| 1 | 空 Profile 启动 | 无历史会话/任务/权限/Memory/工作区/开发者日志 | 需桌面启动 |
| 2 | 环境页「AI 执行方」卡片 | 可见 OpenClaw / PAI / 去配大脑 / 去对话 | UI |
| 3 | 默认 OpenClaw 未连接发指令 | 不出现「必须先配置大脑」拦截；进入 OpenClaw 路径或不可用说明 | 路由单测已覆盖逻辑 |
| 4 | 说「怎么用创作台」 | 内置教程可用 | UI |
| 5 | 改选 PAI | `agentRuntimeMode=pai` 写入；pill 更新 | UI |
| 6 | 设置「失败回退 PAI」 | 默认未勾选 | 默认值单测/门禁已覆盖 |
| 7 | 导出诊断 / 备份 | 不含 secrets.json / token | 单元测试已有 |
| 8 | NSIS vs Portable 数据目录 | 均指向同一 AppData（免安装版） | 文档事实；安装级待签名包 |

## Gate 状态

- Installed Runtime Gate：**blocked/pending**（无最终签名 EXE；本任务不签名）
- 本草案不得被记为 Public Release PASS

## 证据缺口（留给所有者）

1. 对最终签名 Installer/Portable 实机安装
2. 升级 / 回滚 / 卸载保留 AppData
3. 真实更新客户端验证 `latest.yml`

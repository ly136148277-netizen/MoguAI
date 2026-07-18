# mogu.coding

## 何时使用
- 在本地仓库改代码、修 bug、加测试
- 需要在 Codex CLI 与 trae-agent 之间切换或对比
- 希望编程任务进入 MOGU 任务中心并可取消

## 操作
- `status`：探测双引擎是否安装
- `preflight`：检查引擎 + 工作区
- `run`：`{ engine: "codex"|"trae", workspace, prompt, model?, provider? }`
- `cancel`：按 `moguTaskId` 终止子进程
- `retry`：失败后换另一引擎重试（不自动双发）
- `trajectory`：读取 trae-agent 轨迹摘要

## 权限
- `status` / `preflight` / `trajectory`：L1
- `run` / `retry`：默认 L2（写盘/执行命令）
- `cancel`：L2

## 环境
- Codex：`codex` 在 PATH，或 `npx @openai/codex`，或设置 `codingCodexPath`
- trae-agent：`D:\Project\vendor\trae-agent` + `uv sync`，或 `codingTraePath`
- 源码旁路：`D:\Project\vendor\openai-codex`、`D:\Project\vendor\trae-agent`（不打进安装包）
- **API Key**：只用 MOGU「大脑模型」里那一份，启动引擎时注入环境变量；不必双填

## 禁止
- 不内嵌 Trae 完整 IDE
- 无工作区、无 prompt 不得 run
- 密钥不进安装包 / 诊断包
- 不要求用户为同一供应商再买第二份 Key

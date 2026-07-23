# mogu.coding（MOGU AI 编程 · 工人）

## 何时使用
- 在本地仓库改代码、修 bug、加测试
- **传达-only**：外部（Cursor）只调用 `dispatch`，不手写补丁
- 在引擎 A / 引擎 B 之间切换或 **双引擎对比取优**
- 希望编程任务进入任务中心并可取消
- 改完后可在 **MOGU AI 精密工厂** 按文件 / **hunk** 审阅、手改、再派工

## 操作
- `status`：探测 moguai 双引擎是否就绪
- `preflight`：检查引擎 + 工作区
- **`dispatch`（推荐传达入口）**：`{ workspace, prompt }` → 无人值守改码 + 验修 + 回报 `ok/files/log/diffSummary`
- `run`：`{ engine, workspace, prompt, autoVerify?, allowPaths?, scopeMode? }` → 规则注入、**文件集锁定**、自动验修、`review` / `hunks` / `quality` / `scope`
- `compare`：双引擎各跑一遍，按验证与改动量打分，应用胜者补丁（需干净 Git 工作区）
- `planScope`：预览将锁定的文件集（不改代码）
- `review` / `accept` / `discard` / `commit` / `verify` / `cancel` / `retry` / `trajectory`
- `hunks` / `rejectHunk` / `acceptHunk`：hunk 级审阅
- `projectContext`：查看将注入的规则与仓库速览

## 只传达用法

```js
await skills.invoke("mogu.coding", "dispatch", {
  workspace: "D:/path/to/repo",
  prompt: "用户原话任务",
});
```

Cursor / 对话侧只 `invoke`，不代改业务代码。

## 改对位置 / 改对内容
- 派工前建轻量索引（符号 + 相对 import），生成目标文件与必须触及的要点
- 写入「执行计划」约束；`planScope` 可预览
- 改后检查 diff 是否触及要点；跑偏则自动内容纠偏一轮
- 云端无人值守默认走 **coding agent 工具环**：`set_plan` → `grep`/`search` → `read` → `apply_patch`（自动 checkpoint）→ `run_tests` → 失败则 `rollback` 再修（`MOGU_CODING_AGENT=0` 可降级直出补丁）
- SWE 环内真验（阶段1）：bench 默认解析 `swebench/sweb.eval.*` 镜像，`conda activate testbed` 后跑 FAIL/PASS；严格模式禁止 `env skip` 假成功（`MOGU_SWE_DOCKER_VERIFY=0` 可关）
- 预拉镜像：`npm run bench:swe:pull-images -- --limit 8`
- 官方 SWE 评分：`bench:swe:eval` LF 规范化；Windows 默认 `--via-wsl`
- 本地 Ollama / 直出补丁走 **多轮** SEARCH/REPLACE（apply 失败 / 空改 / verify 失败回灌再修）

## 文件集锁定
- 可显式传 `allowPaths`，或用准确率计划的目标文件
- `scopeMode`：`trim`（默认，越界回滚）/ `warn` / `strict` / `off`
- 置信度低时不强制锁定，避免误拦
- 默认排除 `.dat/.fits` 等 fixture

## 项目约定
派工时自动读取（若存在）：`.moguai/rules.md`、`AGENTS.md`、`MOGUAI.md`、`.cursorrules` 等，并附顶层目录速览。

## 自动验修
默认开启：有 `package.json` 的 `test` 脚本时，改完跑 `npm test`（或设置里的 verify 命令）；失败则带着失败日志再修（`maxFixRounds`，`dispatch` 默认 3）。无测试脚本则跳过，不空跑。

## 环境
- 引擎键：`moguai_a` / `moguai_b`
- 入口：`moguai-coding-a` / `moguai-coding-b`
- 运行时目录：用户数据下 `moguai-runtimes/`（应用自动创建布局）
- 设置页可「检查更新 / 安装升级」：只装应用适配表里的官方版本
- API Key：复用大脑那一份
- 云端批跑：`MOGU_CLOUD_PATCH=1` + `OPENAI_BASE_URL` + Key（默认启用 `coding_agent`；`MOGU_CODING_AGENT=0` 回退直出补丁）
- **精密工厂**：桌面「精密工厂」页 — 编辑/diff/派工/hunk/对比；JS/TS 补全与跳转；Node 调试

## 禁止
- 无工作区、无 prompt 不得 `dispatch` / `run` / `compare`
- 密钥不进安装包 / 诊断包

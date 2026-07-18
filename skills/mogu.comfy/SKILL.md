# mogu.comfy

## 何时使用
- 用户要列出 ComfyUI / PAI 工作流
- 用户要提交出片、查进度、或精确取消当前出片任务

## 操作
- `list` — 列出工作流目录
- `preflight` — 检查 PAI / ComfyUI 是否就绪
- `run` — 执行自然语言命令（如「列出工作流」「确认出片 …」）
- `status` — 查询进度（可带 `promptId`）
- `cancel` — **必须**提供 `promptId`，禁止无 ID 全局清队列

## 权限
- 默认 L2；删除/危险清理类命令升至 L3（由 PermissionProxy 判定）

## 禁止
- 不要在缺少 `prompt_id` 时猜测取消目标
- 不要绕过 MOGU 权限确认

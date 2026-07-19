# mogu.memory

## 何时使用
- 跨天记住用户偏好、项目路径、常用约定
- 回答前召回「上次说过的事实」

## 操作
- `status` / `preflight`
- `remember`：`{ key?, value, tags? }`
- `recall`：`{ query, limit? }`
- `list`：最近条目
- `forget`：`{ id }` 或 `{ key }`

## 权限
- `recall` / `list` / `status`：L1
- `remember` / `forget`：L1（本地用户数据，仍记入任务时可跳过）

## 环境
- 本地 `userData/memory/facts.json`，不上传
- 可后续换成 Mem0 / Letta，本 Skill 接口保持稳定

## 禁止
- 不把 API Key / 密码写入记忆

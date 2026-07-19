# mogu.memory

## 何时使用
- 跨天记住偏好、项目路径、约定
- 大脑开聊前会自动 recall；高价值事实会自动沉淀

## 分层
- `preference`：稳定偏好（「我喜欢…」「默认用…」）
- `project`：项目路径 / 工作区
- `session`：会话级短注（较少自动写）

## 操作
- `status` / `preflight`
- `remember`：`{ key?, value, layer?, tags? }`
- `recall`：`{ query, layer?, limit? }`
- `list` / `forget`

## 权限
- 读写本地记忆默认 L1（经 SkillRuntime 只读通道）

## 环境
- `userData/memory/facts.json`
- 可后续换成 Mem0 / Letta，接口保持稳定

## 禁止
- 不把 API Key / 密码写入记忆

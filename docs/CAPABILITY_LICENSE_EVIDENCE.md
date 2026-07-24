# Capability License Evidence Log

```yaml
date: 2026-07-24
status: 2.1 IMPORTS CLOSED · future candidates remain research-only
legal_conclusion: technical evidence complete for imported dependencies; owner retains release approval
```

## 方法

- 只记录可核对的公开入口与仓库内已有引用。
- 未下载/未粘贴任何许可证全文时标注 `UNKNOWN`。
- “别人也这么做”不构成许可。

## 2.1 实际引入项

### node-pty 1.1.0

- 能力：Windows ConPTY/PTY 进程适配层。
- 上游：`https://github.com/microsoft/node-pty`
- npm：`node-pty@1.1.0`
- tag/commit：`v1.1.0` / `1def5774632305246fe21f0f69e23a664d6c5910`
- License：MIT；版权与许可文本见 `THIRD_PARTY_NOTICES.md`。
- 完整性：npm SRI
  `sha512-20JqtutY6JPXTUnL0ij1uad7Qe1baT46lyolh2sSENDd4sTzKZ4nmAFkeAARDKwmlLjPx6XKRlwRUxwjOy+lUg==`。
- 二级运行依赖：`node-addon-api@7.1.1`，MIT，commit
  `5e96a5460f2538a06f87e592d6aa349a7f08b04a`；无继续运行依赖。
- 采用方式：精确版本直接依赖；由 MOGU `SessionManager` 封装，不暴露原始模块给 Renderer。
- 权限/数据：高风险进程能力；必须经过授权回调、路径根、环境白名单、超时、输出上限和审计。
- 安装风险：含 native install/postinstall；CI 只允许 lockfile 固定的包并核对 SRI，禁止运行时更新。
- 遥测/网络：未在 MOGU Adapter 中提供网络或遥测路径；上游原生库只负责 PTY。
- 维护责任：MOGU Trust/Runtime；升级必须重新审计 ABI、prebuild、依赖、SRI、License 和测试。

### MOGU 内部 clean-room / 既有代码复用

- RepoIndex、静态引用/调用边：复用本 MIT 仓库既有 `coding-*` 思路与实现接口，没有复制 Aider/Cursor 专有代码。
- LSP Manager：MOGU 自行实现协议客户端，只使用 Node 标准库；未打包语言服务器。
- TestDiscovery、Worktree Manager、event store、lease/retry/checkpoint、OpenAI-compatible adapter：
  MOGU 自行实现，只使用 Node 标准库和既有项目依赖。
- 语言服务器属于用户配置的外部进程。每个服务器在进入推荐列表或安装流程前必须单独登记
  版本、License、分发条件和安全边界；当前版本不下载、不捆绑、不自动更新服务器。

## 研究候选（未引入）

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

## Gate 结论

`node-pty@1.1.0` 及其唯一运行依赖的来源、版本、SRI、MIT License、Notice、安全边界和维护责任
已登记并由 `npm run audit:v2.1-deps` 机械验证。其能力仍 Default-Off。

其余研究候选没有作为 2.1 新代码或依赖引入，`UNKNOWN` 不授权采用。任何未来引入都必须新增独立
证据条目；最终公开发布及 Default-On 仍由所有者讨论批准。

# MOGU AI 方案进程：到 v2.0

> 存档日期：2026-07-19  
> 产品定位：**通用个人 AI 助手的桌面控制中心**  
> 「本机」是能力（可控电脑、隐私、接本地模型），不是产品边界。

---

## 一、一句话目标

**不必从零改写去超越 OpenClaw（小龙虾）。**  
用 OpenClaw 做可升级的 Agent Runtime；用 MOGU 做中文桌面体验、权限、任务、资产与创作 Skills。  
到 v2.0：别人电脑上也敢安装、敢长期使用，并且「对话办事 + 创作工作流」在同一产品里闭环。

---

## 二、不做清单（全程有效）

| 禁止 | 原因 |
|------|------|
| 整包复制 OpenClaw 进仓库自己维护分叉 | 升级、安全、进程管理全变成自有负担 |
| Electron 内硬嵌完整 Gateway 当进程内核 | 与「受控、可升级 Runtime」冲突 |
| 继续横向堆功能（应用商店、评分、多平台）而欠安全债 | 当前最值钱的是「把工具链管住」 |
| 砍掉 ComfyUI / PAI / Ollama | 它们应变成高质量 Skills，不是被删除 |
| 用「本地创作控制台」当对外唯一 slogan | 过窄，不符合通用助手目标 |

---

## 三、目标架构

```text
MOGU 桌面端（品牌 · 体验 · 权限 · 资产）
├─ 对话工作台 / 任务中心 / 记忆视图 / 技能管理 / 设置
├─ OpenClaw Bridge（连接 · 启停 · 版本钉扎 · 健康检查）
│     └── OpenClaw Gateway（渠道 · Skills · 子 Agent · 定时 · 浏览器 · 模型路由 · 沙箱）
└─ MOGU Skills（先本地，后可扩展）
   ├─ 电脑控制
   ├─ ComfyUI 创作
   ├─ PAI 工作流
   ├─ Ollama / 模型管理
   └─ 文件 · 视频合成 · 备份恢复
```

**分工原则**

| 层 | 负责 |
|----|------|
| OpenClaw | Agent 基础设施：会话、Skills、渠道、定时、浏览器、路由 |
| MOGU | 安装配置、可视化、权限确认、任务中心、创作资产、备份诊断 |
| PAI（过渡期） | 现有本机执行与 ComfyUI 桥；逐步 Skill 化，不再当「唯一 Agent 内核」 |

---

## 四、版本总览

| 版本 | 周期（建议） | 主题 | 对用户的交付物 |
|------|--------------|------|----------------|
| **v1.5.4** | 1–2 周 | 稳定与安全热修 | 敢取消、密钥不裸奔、媒体路径受控、单实例、文档对齐 |
| **v1.6.0** | 3–5 周 | OpenClaw Bridge + 任务/数据中心 | 能连上小龙虾；统一任务与数据视图 |
| **v1.7.0** | 6–10 周 | Skills 化 + 创作可靠 | PAI/ComfyUI 成标准 Skills；创作预检与恢复 |
| **v2.0.0** | 再 4–8 周 | 通用助手控制中心 | 对话为主入口；渠道/技能/权限产品化；创作是能力不是全部身份 |

旧路线图中「V2.0 = Ollama 自动启动」作废；**本文件定义的 v2.0 为上述产品形态。**

---

## 五、v1.5.4 — 稳定与安全（必做债）

**目标：** 不引入 OpenClaw 也能先让现有 1.5.3 更敢给别人装。

### 5.1 任务不误杀

- [x] PAI / Studio 提交时保存本端 `prompt_id`（或等价追踪 ID）
- [x] `studio:cancel` **绑定当前 runId/promptId**，禁止猜测其他任务；无 ID 必须确认后才全局取消
- [x] 运行中任务：仅当 ComfyUI ≥ 0.3.56 时定向 `/interrupt`；旧版运行项需全局确认（排队项仍可 `delete`）
- [x] 无法精确定位时：明确二次确认文案（「将影响 ComfyUI 上其他任务」）

### 5.2 密钥与设置

- [x] API Key 迁出明文 `settings.json` → Electron `safeStorage`（不可用则失败关闭，禁止明文降级）
- [x] `settings:get` 对渲染层只返回「已配置 / 未配置」与脱敏展示
- [x] `settings.json` 增加 `schemaVersion` + 原子写入（studio-pipeline / catalog 可后续对齐）

### 5.3 Electron 与本地桥硬化

- [ ] `sandbox: true`（在兼容前提下）
- [ ] 导航拦截 / `setWindowOpenHandler` / IPC 来源校验
- [x] `requestSingleInstanceLock` 单实例
- [x] `mogu-media` / `studio:media-url`：**白名单根目录**（PAI/ComfyUI/MOGU 输出等）+ 扩展名 + 大小上限

### 5.4 发布与文档卫生

- [x] 去掉 `package.json` 中 `example.com` 占位 publish URL
- [x] `SECURITY.md` / ROADMAP 版本对齐 **1.5.x**（验收脚本命名可随发版再改）
- [ ] 固定流程：干净分支 → `npm test` → `npm run dist` → 校验 asar/版本 → 再发 Release（解决「源码与安装版易分叉」）
- [ ] （可选）文件版本资源写入应用版本；签名证书另立项

### 5.5 运维体验

- [ ] 日志轮转
- [ ] 「导出诊断包」（设置、环境灯、日志摘要、无密钥）

**退出标准：** 取消不再默杀他人任务；密钥不进明文；媒体协议不可读任意盘；发版清单可复现。

---

## 六、v1.6.0 — OpenClaw Bridge + 任务/数据中心

**目标：** MOGU 能**连接并管理**本地 OpenClaw，同时有统一任务与数据视图。PAI 仍可跑，但不再是唯一对话内核。

### 6.1 OpenClaw Bridge（MVP）

契约全文见 [`OPENCLAW_BRIDGE.md`](./OPENCLAW_BRIDGE.md)（**不得**缩成仅 `status` / `send`）。

- [ ] 检测本机是否已安装 OpenClaw / Gateway 是否在跑
- [ ] 安装/升级引导（官方安装路径，版本钉扎，不 fork）
- [ ] 启停 Gateway、健康检查、状态灯（首页 + 环境页）
- [ ] **版本/能力探测**（`hello-ok` protocol / features / server.version）
- [ ] **认证连接**（token 仅主进程；渲染层不可见）
- [ ] **创建会话 + 发起 Agent Run**（映射 `sessions.*` / `chat.send`）
- [ ] **流式事件订阅**（规范化事件推 UI）
- [ ] **`sessionId` / `runId` / `taskId` ↔ `moguTaskId` 映射与持久化**
- [ ] **精确取消**（`tasks.cancel` / `sessions.abort`；无 ID 不静默全局杀）
- [ ] **断线重连、超时、降级到 PAI**
- [ ] 设置页：Gateway 地址、端口、启用开关、版本显示、降级开关

### 6.2 对话工作台（双轨过渡）

- [ ] Agent 页支持模式：`内置/PAI（兼容）` | `OpenClaw（主推）`
- [ ] OpenClaw 模式下：消息进 Gateway；MOGU 负责 UI、确认框、任务卡片
- [ ] **授权归属：** 高风险 `mogu.*` 统一走 MOGU 权限代理（含外部渠道触发）；桌面不在线 → 默认拒绝/超时拒绝，禁止绕过确认

### 6.3 任务中心

- [ ] 统一列表：来源（Studio / PAI / OpenClaw）、状态、重试、取消、日志、输出路径
- [ ] ID 模型对齐 Gateway：`sessionKey`/`sessionId`、`runId`、`taskId` + 本端 `moguTaskId` / Comfy `prompt_id`

### 6.4 数据中心（只读 + 备份雏形）

- [ ] 扫描占用：AppData / PAI / Ollama / ComfyUI（可配置路径）
- [ ] 一键导出备份包（配置 + 会话索引 + 清单；模型文件可选/外挂）
- [ ] 清理策略：缓存 / 旧 runs（默认需确认）

### 6.5 信息架构（轻重组，不大翻）

建议导航收敛为：

```text
首页 · 对话 · 任务 · 创作 · 模型 · 环境与数据 · 设置
```

- 「Agent模型 / Agent」合并认知到 **对话 + 模型**
- 「视频合成」挂在 **创作** 子流程，不抢主入口

**退出标准：** 用户能在 MOGU 里看到 OpenClaw 绿灯、发通一条办事消息；任务中心能看见 Studio 与 Agent 任务。

---

## 七、v1.7.0 — Skills 化与创作可靠性

**目标：** ComfyUI / PAI / Ollama / FFmpeg 变成 **MOGU Skills**（对 OpenClaw 表现为标准 Skills 或 Bridge 工具），创作链路可预检、可恢复。

### 7.1 Skills 包装

`SKILL.md` 只教 Agent「何时/如何用工具」，**不等于**受控执行能力。每个 `mogu.*` 必须四件套交付（见 [`OPENCLAW_BRIDGE.md`](./OPENCLAW_BRIDGE.md) §5）：

```text
Skill 说明（SKILL.md）
+ 实际工具实现（Bridge Plugin / MCP / 本地服务）
+ 权限声明与确认策略
+ 任务 ID、日志、输出契约
```

| 名称 | 能力 | 验收（四件套齐全） |
|------|------|-------------------|
| `mogu.pc` | 打开应用、搜文件、备份 | 可调用 + L2/L3 权限代理 + 任务/日志 |
| `mogu.comfy` | 列工作流、提交/取消、进度 | 绑定 `prompt_id` / 任务中心；精确取消 |
| `mogu.studio` | 创作台参数化出片 | 与 Studio UI 同步 + 输出契约 |
| `mogu.ollama` | 模型列表、导入、聊天路由 | 与模型页一致 |
| `mogu.media` | 拼接、打开外部剪辑 | 路径白名单 + FFmpeg 等实现 |

- [ ] 禁止只交 `SKILL.md` 而无实现/权限/任务契约
- [ ] Skill 清单与权限级别写入文档
- [ ] 技能管理页：启用/禁用、说明、所需环境灯

### 7.2 创作台可靠性

- [ ] 工作流预检：缺模型、缺节点、ComfyUI 离线、路径错误
- [ ] 失败重试、断点恢复（至少「同参数再跑」）
- [ ] 输出 provenance：模型 / 工作流 / 参数 / 耗时 / 任务 ID
- [ ] （可选）批量生成队列

### 7.3 测试与质量

- [ ] Bridge 契约测试（mock Gateway）
- [ ] 关键 UI E2E：导航、取消、Skill 确认框
- [ ] 验收脚本升级为 `acceptance_v1.7`（替换 v1.4.0 命名）

**退出标准：** 不打开「旧管家页」也能用 Skills 完成：打开 ComfyUI → 出片 → 拼视频；失败有预检而非黑盒超时。

---

## 八、v2.0.0 — 通用个人 AI 助手控制中心

**目标：** 对外身份是「个人 AI 助手桌面中心」；创作、模型、本机控制都是能力模块。

### 8.1 产品主路径

- [ ] **对话** 为默认首页主入口（办事 / 问答 / 引导）
- [ ] OpenClaw 为默认 Agent Runtime；PAI 直连降为兼容/高级
- [ ] 渠道（Telegram 等）通过 OpenClaw 配置，MOGU 提供引导与状态，不自研全套协议
- [ ] 技能市场：**先管本地 Skills + 官方/白名单安装**，不做大而全应用商店

### 8.2 体验与信任

- [ ] 权限中心：按 Skill / 工具授权，可撤销
- [ ] 会话 / 工作区隔离（依赖 OpenClaw，MOGU 可视化）
- [ ] 备份 / 恢复 / 诊断包产品化
- [ ] （可选）代码签名、自动更新链路清洁（无占位 URL）

### 8.3 v2.0 明确不做

- 多平台原生客户端（先把 Windows 做透）
- 评分评论社区
- ModelScope 大而全分发（可后置插件）
- 自研第二套 Agent Runtime 与 OpenClaw 并行抢活

**退出标准：**

1. 新用户：安装 MOGU → 环境灯 → 接通 OpenClaw → 对话办事成功  
2. 创作者：同一产品内完成模型 / 出片 / 合成，且任务可追踪可取消  
3. 发布：可复现构建 + 文档与版本一致 + 安全基线（密钥、媒体、取消）达标  

---

## 九、里程碑与依赖

```mermaid
flowchart LR
  v154[v1.5.4 安全稳定]
  v160[v1.6 Bridge与任务数据]
  v170[v1.7 Skills与创作可靠]
  v200[v2.0 助手控制中心]
  v154 --> v160 --> v170 --> v200
  OC[OpenClaw 官方升级]
  OC -.-> v160
  OC -.-> v170
  OC -.-> v200
```

| 依赖 | 说明 |
|------|------|
| OpenClaw 版本钉扎 | Bridge 声明兼容版本区间；升级走引导，不静默大版本 |
| PAI | v1.6–1.7 期间仍是执行与 Comfy 桥；v2.0 后以 Skill 形态存在 |
| 签名证书 | 不阻塞功能版本；单独并行 |

---

## 十、成功度量（到 v2.0）

| 指标 | 目标 |
|------|------|
| 误杀他人 ComfyUI 任务 | 默认路径为 0（无确认则不全局清队列） |
| 密钥落盘 | 无明文 API Key 于 `settings.json` |
| Bridge | 一键检测 + 启停 + 对话往返成功率（本机冒烟） |
| 发版 | 源码 tag、安装包、asar 版本号一致可核对 |
| 文档 | SECURITY / ROADMAP / README 版本与能力描述一致 |

---

## 十一、近期执行顺序（给开发用）

1. **契约基线（已完成草案）**：[`OPENCLAW_BRIDGE.md`](./OPENCLAW_BRIDGE.md)；`ROADMAP.md` 旧 V2.0 已标历史归档  
2. **下一步 v1.5.4**：精确取消 → 密钥 → 媒体白名单 → 单实例 → 文档/占位清理  
3. **v1.6 开工条件**：v1.5.4 退出标准满足后，按 Bridge 契约实现（含 ID 映射、流式、取消、降级、权限代理），避免「新底座 + 旧安全债」叠爆  

---

## 十二、相关文档

| 文档 | 用途 |
|------|------|
| [README.zh-CN.md](../README.zh-CN.md) | 对外产品说明（随版本改） |
| [SETUP_HUB_v1.5.md](./SETUP_HUB_v1.5.md) | 环境中心 |
| [STUDIO_v1.5.md](./STUDIO_v1.5.md) | 创作台 |
| [COMFYUI_WORKFLOWS.md](./COMFYUI_WORKFLOWS.md) | 工作流 FAQ |
| [RELEASE.md](./RELEASE.md) | 发版 |
| [MOGU_AI_桌面端存档.md](../MOGU_AI_桌面端存档.md) | Agent 交接存档（需同步本方案结论） |
| [OPENCLAW_BRIDGE.md](./OPENCLAW_BRIDGE.md) | **Bridge / 权限 / Skill 四件套契约**（v1.6 事实来源） |

---

*本方案替代旧 ROADMAP 中「V2.0 = Ollama 自动启动进行中」的表述；历史 V1.0–V1.5.3 已交付内容仍以 CHANGELOG / 桌面端存档为准。*

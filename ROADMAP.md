# ROADMAP.md

> 基于当前源码与项目历史整理，非凭空规划。
> **北极星与 2.1–3.0 能力融合总纲：** [`docs/MOGU_NORTH_STAR_AND_CAPABILITY_FUSION.md`](./docs/MOGU_NORTH_STAR_AND_CAPABILITY_FUSION.md)
> **当前里程碑（Public RC）：** [`docs/PUBLIC_RELEASE_FINAL_FREEZE.md`](./docs/PUBLIC_RELEASE_FINAL_FREEZE.md)
> **到 v2.0 的历史实施方案：** [`docs/ROADMAP_TO_V2.md`](./docs/ROADMAP_TO_V2.md)
> **OpenClaw Bridge 契约：** [`docs/OPENCLAW_BRIDGE.md`](./docs/OPENCLAW_BRIDGE.md)
> 北极星：以 GPT-5.6 为默认大脑，融合经验证的 Agent 能力，成为最强 Windows 个人 AI 工作台。
> 当前顺序：Public RC → 2.1 Capability Fusion → 2.2 Frontier Coding → 2.3 Autonomous Tasks → 2.4 Evidence Memory → 3.0 Autonomous Workspace。
> 文末「历史归档」旧 V2.0 章节已作废，勿作规划依据。

---

## 版本总览

| 版本 | 状态 | 说明 |
|------|------|------|
| V1.0 | ✅ 已完成 | Electron 桌面应用基础框架 |
| V1.1 | ✅ 已完成（v1.1.0） | 核心功能完整：仓库/下载/Ollama/聊天/设置/打包 |
| V1.2 | ✅ 已完成（发版号 v1.2.1） | 体验优化 + 图标 + sha256 校验 |
| V1.3 | ✅ 已完成（v1.3.0） | MOGU AI 品牌、聊天导出、Ollama 引导、保存路径提示 |
| V1.4–V1.5.3 | ✅ 已完成 | CDN、自动更新、创作台、视频合成、环境中心、发版 |
| V1.5.5 | ✅ 基线 | 打包白名单 + ASAR denylist；`v1.5.4` 安装包已 yank |
| V1.6.0-alpha → V2.0 | ✅ 产品形态已形成 / RC 冻结中 | Bridge → 任务中心 → Skills → 助手控制中心 |
| V2.0 Public RC | 🚧 Day 0–4 完成，Day 5–7 待继续 | 安全、干净、可安装、证据绑定的公共交付底座 |
| V2.1 | ✅ 实现完成 / 默认关闭 | Agent Capability Fusion：本地门禁通过；GPT-5.6 A/B BLOCKED；封存 holdout 未开启 |
| V2.2 | 🚧 协议脚手架 | 单任务 Neural Layer；完整 DAG、全局调度与迁移留待 V2.3 |
| V2.3 | 📋 后续 | Autonomous Task System |
| V2.4 | 📋 后续 | Evidence-based Memory |
| V3.0 | 🎯 北极星 | Autonomous Workspace / Windows 最强个人 AI 工作台 |

---

## V1.0 — 基础框架

**目标：** 搭建 Electron 桌面应用骨架

- [x] Electron 三层架构（main / preload / renderer）
- [x] 基础窗口与 IPC 通信
- [x] 项目目录结构确立

---

## V1.1 — 核心功能（v1.1.0）

**目标：** 完整的本地 AI 模型管理闭环

### 基础架构
- [x] IPC 完整桥接（`window.modelManager`）
- [x] 主进程模块化（9 个模块）

### 模型仓库
- [x] 搜索、分类、标签、收藏
- [x] 本地 GGUF 扫描
- [x] 远程仓库同步接口
- [x] 内置 3 个预置模型

### 下载
- [x] 多线程下载（1/2/4/8 线程）
- [x] 断点续传
- [x] 下载队列与并发控制
- [x] SHA256 校验
- [x] 失败自动重试
- [x] 镜像源（官方 / HF Mirror / 自定义）

### Ollama 集成
- [x] Modelfile 自动生成
- [x] `ollama create` 导入
- [x] 下载后自动导入
- [x] 手动导入 / 移除
- [x] 状态检测
- [x] Chat API 流式对话

### 聊天
- [x] 多会话管理
- [x] Markdown 渲染
- [x] Prompt 模板
- [x] Token 统计
- [x] 历史记录持久化

### 产品化
- [x] 设置中心（线程、镜像、主题、语言）
- [x] 日志系统
- [x] 中/英国际化
- [x] Windows 打包（NSIS + Portable）
- [x] 单元测试 31 项

---

## V1.2 — 体验优化（当前稳定版 v1.2.0）

**目标：** 产品体验优化，不新增大型功能（需求编号 V1.2-001 ~ V1.2-005）

### V1.2-001 首页优化 ✅
- [x] 去掉 Electron 默认英文菜单
- [x] 欢迎说明文案
- [x] 「快速开始」四步指引
- [x] 「最近使用」区域（最近下载/聊天/导入）
- [x] 版本信息与帮助入口

### V1.2-002 软件导航结构 ✅
- [x] 7 项左侧导航（首页/仓库/下载/聊天/我的模型/设置/帮助）
- [x] `page-controller.js` 拆分页面控制
- [x] `chat.js` 接入导航
- [x] 各页「返回首页」
- [x] 当前页高亮

### V1.2-003 完整用户流程 ✅
- [x] 下载 → 自动导入 → 「开始聊天」按钮
- [x] 点击「开始聊天」进入聊天页（`ChatUI.enterWithModel`）
- [x] 导入完成后从下载页跳转「我的模型」

### V1.2-004 我的模型页 ✅
- [x] 独立「我的模型」页面（`pages/my-models-page.js`）
- [x] 顶部统计（已安装/已导入/总占用）
- [x] 模型卡片（参数、量化、路径、下载时间、状态）
- [x] 操作：聊天 / 打开目录 / 重新导入 / 删除
- [x] 空状态引导
- [x] `models:delete` IPC（删除 GGUF + Modelfile + Ollama）

### Release-001 打包验证 ✅
- [x] `npm run dist` 成功
- [x] NSIS 安装包 + Portable 便携版
- [x] 修复 `signAndEditExecutable: false`

### V1.2-005 弹性布局与滚动 ✅
- [x] 模型仓库 / 下载中心 / 我的模型：窗口缩小时列表可滚动
- [x] 首页 / 软件设置：小窗口内容可完整浏览
- [x] 首页按钮不再被面板裁切
- [x] 根布局高度链 + Grid `minmax(0,1fr)` 修复

### Release-002 发版 v1.2.0 ✅
- [x] `package.json` version bump 至 1.2.0
- [x] 更新 CHANGELOG / README / PROJECT_CONTEXT / ROADMAP
- [x] `npm test` + `npm run dist` 验证通过
- [x] Git tag `v1.2.0`

### V1.2 后续可选 📋
- [x] 自定义应用图标
- [x] 补充内置模型 sha256（并修正 Qwen 下载 URL）

### Release-003 发版 v1.2.1 ✅
- [x] 应用图标 + sha256 + Qwen URL 修复
- [x] `npm test` + `npm run dist`

### 工程化 ✅
- [x] Git 仓库初始化（`v1.1.0` 标签）
- [x] `.gitignore` 配置（忽略 node_modules、dist 等构建产物）

### Release-004 发版 v1.3.0 ✅
- [x] 品牌统一（productName MOGU AI、i18n、帮助文案）
- [x] 聊天导出 Markdown
- [x] Ollama 未运行高亮引导
- [x] 改保存路径提示（不自动迁移旧文件）
- [x] `npm test` + `npm run dist`

---

## V1.3 — MOGU AI 品牌发版（v1.3.0）

**目标：** 桌面端（模型/聊天/壳）产品化收尾，与管家 Phase 2 并行

- [x] `package.json` v1.3.0、`productName: MOGU AI`
- [x] 首页/帮助 i18n 文案
- [x] Ollama 工具栏高亮 + 启动按钮脉冲
- [x] 保存路径弹窗与状态栏说明
- [x] 聊天会话导出 Markdown（IPC + UI）
- [x] 聊天智能滚动（用户上滑时不强制跳底）

---

## 历史归档 — 旧「V2.0」章节（已作废，勿作规划依据）

> **唯一现行主线：** [`docs/ROADMAP_TO_V2.md`](./docs/ROADMAP_TO_V2.md)
> **Bridge 契约：** [`docs/OPENCLAW_BRIDGE.md`](./docs/OPENCLAW_BRIDGE.md)
> 下文保留仅为历史对照。旧定义「V2.0 = Ollama 自动启动 + 横向功能清单」**已废止**；Ollama 启停属于已交付的 1.x 能力，不再占用 v2.0 语义。

### （归档）曾标注为 V2.0-001 — 自动检测与启动 Ollama

- [x] 三级状态：未安装 / 已安装未运行 / 运行中
- [x] 主进程 `ollama serve` 后台启动 + API 轮询
- [x] 顶部状态栏「启动 Ollama」「下载安装」按钮
- [x] 设置项 `autoStartOllama` 启动时自动拉起
- [x] IPC：`ollama:start`、`ollama:open-install`

### （归档）旧 V2.0 其余条目（未纳入现行主线）

- 模型详情页 / 评分评论、ModelScope 大而全、多模型并行、macOS/Linux、插件商店等 —— 现行 v2.0 **明确不做或后置**；见 `ROADMAP_TO_V2.md` §8.3。
- 聊天导出 Markdown、CDN、自动更新等 —— 已在 1.x 交付或另按主线排期，**不以本归档列表为准**。

---

## 状态图例

| 标记 | 含义 |
|------|------|
| ✅ | 已完成（源码可验证） |
| 🔄 | 开发中 / 已实现未发版 |
| 📋 | 待开发（源码中无实现） |

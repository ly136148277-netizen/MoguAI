# CHANGELOG.md

本文件记录 AI 模型管理助手（ai-model-manager）的版本变更。  
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [1.4.0] - 2026-07-11

### Added
- **在线模型库 CDN 同步**：`catalog/models.json`（8 个模型），写入 `%APPDATA%/models-catalog.json`
- CDN 不可用时自动回退安装包内置 catalog
- **自动更新**：`electron-updater` + `config/update.json` + 设置页检查/下载/安装
- 设置页显示模型库版本与上次同步时间
- 发版文档 `docs/RELEASE.md`、签名示例 `config/signing.example.env`

### Changed
- 模型库扩充：Qwen2.5 3B、Gemma 2 2B、DeepSeek R1 Distill 7B、Mistral 7B v0.3、Nomic Embed v1.5
- `config/repository.json` 默认 jsDelivr syncUrl

---

## [1.3.0] - 2026-07-11

### Added
- **蘑菇AI 品牌发版**：安装包 productName、首页与帮助文案统一为蘑菇AI
- 聊天会话 **导出 Markdown**（`chat:sessions:export` + 聊天页「导出 Markdown」按钮）
- Ollama 未运行时顶部工具栏高亮 +「启动 Ollama」按钮脉冲提示
- 更改模型保存位置时说明：**已下载文件不会自动移动**

### Changed
- 版本号升至 **1.3.0**
- 聊天长对话：仅在用户位于底部附近时自动跟随滚动（流式输出时可上滑阅读历史）

---

## [Unreleased]

### Added
- **AI 执行管家 Phase 2**：L2/L3 二次确认（`butler-risk.js`）、ComfyUI 出片面板与进度轮询
- **蘑菇AI · AI 执行管家**：PAI HTTP 桥接（`pai-bridge.js`）、管家页（`butler.js`）、17 项 Capability 快捷指令
- **一键识别本机环境**：扫描 Ollama / ComfyUI / PAI，Doctor 抽检，可选写入 `pai.yaml`（`env-scan.js`）
- 侧边栏分组：**AI 聊天问答** / **AI 执行管家**（含子入口）
- 权限等级自定义下拉（替代 Windows 原生 select 白底问题）
- **V2.0-001** Ollama 三级状态检测（未安装 / 已安装未运行 / 运行中）
- 顶部「启动 Ollama」「下载安装」按钮
- 设置项：启动时自动启动 Ollama / PAI（`autoStartOllama`、`autoStartPai`）
- 模型保存位置：可选盘符、浏览文件夹、手动输入路径
- **我的模型**：双目录查找（当前保存路径 + AppData 旧目录）、force 重新导入
- IPC：`ollama:start`、`ollama:open-install`、`pai:*`、`env:scan`、`env:apply-comfyui`、`comfyui:status`

### Changed
- 品牌与窗口标题：**蘑菇AI**（模型管理 · 电脑管家 · 视频出片）
- 全应用可点击按钮统一蓝色主按钮（危险/取消操作保留红/灰）

### Fixed
- `renderer.js` 重复变量导致路由/init 失败、侧边栏点击无响应
- 我的模型旧目录找不到 GGUF、重新导入失败

---

## [1.2.1] - 2026-07-11

### Added
- 自定义应用图标（`assets/icon.png`，打包时写入 exe）

### Changed
- 内置 3 个模型补充 HuggingFace LFS SHA256 校验值
- 修正 Qwen 2.5 7B 下载地址（原 Q4 单文件 URL 404，改为官方单文件 `Q3_K_M`）
- 同步修正 Llama / Phi-3 / Qwen 的 `sizeBytes` 与 HuggingFace 一致

### Fixed
- Qwen 模型无法下载（404）

---

## [1.2.0] - 2026-07-06

### Added
- 首页：欢迎说明、「快速开始」指引、「最近使用」统计、版本信息与帮助入口
- 软件导航：7 页结构（首页 / 模型仓库 / 下载中心 / AI 聊天 / 我的模型 / 软件设置 / 使用帮助）
- `page-controller.js` 页面路由控制模块
- `pages/my-models-page.js` 独立「我的模型」页面（统计、卡片、状态、操作按钮）
- `models:delete` IPC：删除 GGUF 文件、Modelfile 及 Ollama 模型
- `storage.js`：`deleteModelFile`、`deleteModelfile` 方法
- `ChatUI.enterWithModel`：从模型页直接进入聊天工作区
- 各子页面「返回首页」按钮
- `.gitignore`（Electron 项目标准忽略规则）

### Changed
- 隐藏 Electron 默认英文菜单栏（`Menu.setApplicationMenu(null)` + `autoHideMenuBar`）
- 聊天页导航：`onChatPageEnter` 支持 pending 模型，避免与 `showPicker` 冲突
- Ollama 导入完成后，若用户在下载中心则自动跳转「我的模型」
- 左侧导航「我的模型」图标调整为 📦
- Windows 打包配置：`signAndEditExecutable: false`（修复 winCodeSign 符号链接权限问题）
- Git 索引移除 `node_modules/`、`dist/` 等构建产物（本地文件保留）

### Fixed
- 打包失败：winCodeSign 解压符号链接权限错误
- 「开始聊天」流程：确保导入后状态刷新再进入聊天
- **页面滚动与弹性布局**（`styles.css`）：
  - 模型仓库 / 下载中心 / 我的模型：窗口缩小时列表区域可滚动
  - 首页 / 软件设置 / 我的模型：小窗口下内容可完整浏览
  - 首页「开始体验」「进入聊天」按钮不再被面板裁切
  - 根布局高度链修复（`html/body/app-shell` + Grid `minmax(0,1fr)`）

---

## [1.1.0] - 2025-12-01

> 核心功能完整可用。

### Added

#### 基础架构
- Electron 三层架构（主进程 / 预加载 / 渲染进程）
- `window.modelManager` IPC 桥接
- 主进程 9 个业务模块

#### 模型仓库
- 模型浏览、搜索、分类/标签筛选、排序
- 收藏功能
- 本地 `.gguf` 文件扫描
- 远程目录同步（`config/repository.json` → `syncUrl`）
- 内置 3 个预置模型：Llama 3 8B、Qwen 2.5 7B、Phi-3 Mini

#### 下载
- 多线程下载（1/2/4/8 线程可配置）
- HTTP Range 断点续传
- 下载队列与最大并发控制
- SHA256 文件校验（模型配置了 sha256 时生效）
- 失败自动重试（最多 3 次）
- 镜像源：官方、HF Mirror、ModelScope、GitHub、自定义 URL

#### Ollama 集成
- 自动检测 Ollama 可用性
- 根据模型配置生成 Modelfile
- `ollama create` 一键导入
- 下载完成后自动导入（可 per-model 配置 `autoImport`）
- 手动导入 / 移除
- Ollama Chat API 流式对话

#### 聊天
- 多会话管理（JSON 持久化）
- 会话搜索、重命名、删除
- 系统提示词模板（4 个内置 + 收藏）
- Markdown 渲染（代码块复制）
- Token 统计（prompt / completion / total）
- 流式回复、停止生成、重新生成、编辑上条用户消息

#### 产品化
- 设置中心：下载线程、并发、镜像、主题（深/浅）、语言（中/英）
- 应用日志（`%userData%/logs/app.log`）
- 首页仪表盘（最近下载/聊天/导入）
- 内置帮助页
- Windows 打包：NSIS 安装包 + Portable 便携版

#### 测试
- 6 个测试文件，31 项单元测试（`npm test`）

### Technical
- Electron ^35.0.0
- 依赖：axios ^1.8.4、fs-extra ^11.3.0
- 开发依赖：electron-builder ^25.1.8
- CSP：`default-src 'self'`

---

## [1.0.0] - 初始版本

### Added
- Electron 桌面应用项目初始化
- 基础窗口与目录结构
- 主进程 / 渲染进程 / 预加载分层

---

## 版本说明

| 版本 | package.json | 说明 |
|------|-------------|------|
| 1.0.0 | — | 项目骨架 |
| 1.1.0 | ✅ | 核心功能完整 |
| 1.2.0 | ✅ | 体验优化 + 弹性布局 |
| 1.2.1 | ✅ 当前 | 图标 + sha256 + Qwen URL 修复 |

**发版检查清单：**
1. 更新 `package.json` → `version`
2. 将 `[Unreleased]` 内容移至新版本节
3. 运行 `npm test`
4. 运行 `npm run dist` 验证打包
5. 更新 `PROJECT_CONTEXT.md` 版本号

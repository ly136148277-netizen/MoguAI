# PROJECT_CONTEXT.md

> 长期项目上下文文档，供后续 Chat 会话快速恢复项目认知。  
> 最后同步版本：**v1.2.1**

---

## 当前版本

| 项 | 值 |
|---|---|
| 包名 | `ai-model-manager` |
| 版本 | **1.2.1**（`package.json`） |
| 产品名 | AI Model Manager / AI 模型管理助手 |
| Electron | ^35.0.0 |
| 许可证 | MIT |

---

## 项目目标

面向**普通用户**的本地 AI 模型管理平台，实现零命令行体验：

```
模型浏览 → 下载 → 自动导入 Ollama → 本地聊天
```

---

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    渲染进程 (Renderer)                   │
│  index.html → app.js(AppRouter) → page-controller.js    │
│  renderer.js(AppCore) │ chat.js │ pages/my-models-page  │
└──────────────────────────┬──────────────────────────────┘
                           │ window.modelManager
┌──────────────────────────▼──────────────────────────────┐
│                    预加载 (preload.js)                   │
│              contextBridge + ipcRenderer                   │
└──────────────────────────┬──────────────────────────────┘
                           │ IPC invoke / events
┌──────────────────────────▼──────────────────────────────┐
│                    主进程 (main.js)                      │
│  ModelRepository │ DownloadEngine │ OllamaService       │
│  StorageManager  │ SettingsStore  │ ChatSessionStore    │
│  Logger │ mirrors.js                                     │
└─────────────────────────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         本地文件系统    Ollama CLI/API   HuggingFace 等
```

**安全模型：** `contextIsolation: true`，`nodeIntegration: false`

---

## 核心模块

### 主进程 (`src/main/`)

| 模块 | 文件 | 职责 |
|------|------|------|
| 入口/IPC | `main.js` | 窗口创建、服务初始化、IPC 中枢、下载完成自动导入 |
| 模型仓库 | `repo.js` | 加载/校验 `models.json`、远程同步、本地 GGUF 扫描、搜索筛选 |
| 下载引擎 | `download-engine.js` | 多线程 Range 下载、断点续传、SHA256 校验、队列 |
| Ollama | `ollama.js` | 检测/列表/Modelfile 生成/create/rm、流式 Chat API |
| 存储 | `storage.js` | GGUF 存储目录、删除模型文件与 Modelfile |
| 设置 | `settings.js` | 下载参数、镜像、收藏、主题、语言、最近下载 |
| 聊天会话 | `chat-sessions.js` | 会话 JSON 持久化、搜索、自动标题 |
| 镜像 | `mirrors.js` | 官方/HF Mirror/ModelScope/GitHub/自定义 URL 解析 |
| 日志 | `logger.js` | 写入 `%userData%/logs/app.log` |

### 渲染进程 (`src/renderer/`)

| 模块 | 文件 | 职责 |
|------|------|------|
| 路由 | `app.js` | `AppRouter`：页面切换、导航高亮 |
| 页面控制 | `page-controller.js` | 注册各页 `onPage`、返回首页绑定 |
| 核心业务 UI | `renderer.js` | 模型列表、下载、设置、仪表盘；导出 `AppCore` |
| 聊天 | `chat.js` | 多会话聊天、`enterWithModel` 导航接入 |
| 我的模型 | `pages/my-models-page.js` | 独立我的模型页 |
| 国际化 | `i18n.js` | 中/英文案 |
| Markdown | `chat-markdown.js` | 聊天气泡 Markdown 渲染 |

### 配置文件

| 文件 | 用途 |
|------|------|
| `models.json` | 内置 3 个 GGUF 模型元数据 |
| `config/repository.json` | 远程同步 URL、数据源列表 |
| `config/prompts.json` | 4 个系统提示词模板 |

---

## 数据流

### 模型下载 → 导入 → 聊天

```
用户点击下载
  → download:start (IPC)
  → DownloadEngine.enqueue → 多线程/断点下载
  → SHA256 校验（若 models.json 配置了 sha256）
  → download-complete (event → renderer)
  → main.js handleDownloadComplete
  → ollama.importModel（若 autoImport !== false）
  → ollama-import-complete (event → renderer)
  → UI 刷新，按钮变为「开始聊天」
  → ChatUI.enterWithModel → ollama/chat API 流式回复
```

### 模型列表数据

```
models.json + 本地扫描 GGUF
  → ModelRepository.getAllModels
  → buildModelList（合并下载状态、Ollama 导入状态、队列状态）
  → models:list (IPC) → renderer 渲染
```

---

## IPC 结构

### 请求/响应（`ipcMain.handle` → `preload` → `window.modelManager`）

| 通道 | 说明 |
|------|------|
| `models:list` | 模型列表（支持 search/filter/category/tag/sort） |
| `models:meta` | 分类、排序、标签、镜像选项 |
| `models:sync` | 远程目录同步 |
| `models:toggle-favorite` | 收藏切换 |
| `models:delete` | 删除 GGUF + Modelfile + Ollama 模型 |
| `settings:get` / `settings:update` | 读写设置 |
| `storage:get-path` / `set-path` / `open-path` | 存储路径 |
| `download:queue` / `start` / `pause` / `resume` / `cancel` | 下载控制 |
| `ollama:status` / `list` / `import` / `remove` | Ollama 操作 |
| `ollama:start` / `ollama:open-install` | 启动 Ollama / 打开安装页 |
| `prompts:list` / `toggle-favorite` | 提示词模板 |
| `chat:sessions:*` | 会话 CRUD、搜索 |
| `chat:send` / `chat:stop` | 发送消息、停止生成 |
| `app:version` / `dashboard:stats` / `app:open-logs` | 应用信息 |

### 主进程推送事件

| 事件 | 说明 |
|------|------|
| `download-progress` | 下载进度 |
| `download-complete` / `download-error` | 下载完成/失败 |
| `ollama-import-progress` / `complete` / `error` | 导入进度/完成/失败 |
| `ollama-removed` | Ollama 模型已移除 |
| `ollama-chat-chunk` | 聊天流式 chunk |

---

## 用户数据存储位置

| 数据 | 路径（默认） |
|------|-------------|
| 模型文件 | `%userData%/models/*.gguf` |
| Modelfile | `%userData%/models/modelfiles/*.Modelfile` |
| 用户设置 | `%userData%/settings.json` |
| 聊天会话 | `%userData%/chat-sessions/*.json` |
| 下载状态 | `%userData%/downloads/` |
| 日志 | `%userData%/logs/app.log` |

---

## 已完成功能

### 基础架构
- [x] Electron 三层架构（main / preload / renderer）
- [x] IPC 桥接 `window.modelManager`
- [x] 模块化主进程

### 模型仓库
- [x] 搜索、分类、标签、排序、收藏
- [x] 本地 GGUF 扫描
- [x] 远程目录同步（需配置 syncUrl）
- [x] 内置 3 个预置模型

### 下载
- [x] 多线程（1/2/4/8）
- [x] 断点续传
- [x] 下载队列与并发控制
- [x] SHA256 校验
- [x] 自动重试（最多 3 次）
- [x] 多镜像源

### Ollama
- [x] 自动生成 Modelfile
- [x] `ollama create` 导入
- [x] 下载后自动导入
- [x] 删除/重新导入
- [x] 状态检测
- [x] Chat API 流式对话

### 聊天
- [x] 多会话持久化
- [x] Markdown 渲染
- [x] Prompt 模板
- [x] Token 统计
- [x] 重新生成 / 停止 / 编辑上条消息

### 产品化
- [x] 7 页导航（首页/仓库/下载/聊天/我的模型/设置/帮助）
- [x] 中/英 i18n、深/浅主题
- [x] 日志
- [x] Windows NSIS + Portable 打包
- [x] 31 项单元测试

---

## 当前开发状态

| 状态 | 说明 |
|------|------|
| **v1.2.1** | 当前版本，V1.2 全部收工（含图标 + sha256） |
| **测试** | `npm test` 31/31 通过 |
| **打包** | `npm run dist` 可生成 NSIS + Portable |
| **Git** | 标签 `v1.1.0`、`v1.2.0`；`.gitignore` 已配置（忽略 node_modules、dist 等） |

---

## 开发规范（项目约定）

1. **修改前先分析影响范围**
2. **不修改无关代码**
3. **优先复用已有模块**（repo、download-engine、ollama、chat-sessions、StorageManager 等）
4. **修改完成后列出修改文件**
5. **修改完成后同步更新文档**，保证与源码一致：
   - `README.md`
   - `PROJECT_CONTEXT.md`
   - `ROADMAP.md`
   - `CHANGELOG.md`
6. **未经允许不得升级版本号**（含 `package.json` version）
7. **未经允许不得重构整个项目**
8. **每次只完成一个需求，完成后等待确认**

**核心模块谨慎改动（非必要不修改）：** `download-engine.js`、`ollama.js`、`repo.js`、`main.js`（IPC 编排）

---

## 后续开发注意事项

1. **版本号：** 仅在用户明确允许时 bump `package.json` version，并同步更新 CHANGELOG
2. **Ollama 依赖：** 聊天与导入功能强依赖本机 Ollama，需在 UI 明确引导安装
3. **sha256：** 内置模型 `sha256` 字段为空，校验实际跳过；生产模型建议补全
4. **syncUrl：** `config/repository.json` 中 `syncUrl` 默认为 `null`
5. **应用图标：** 打包使用 Electron 默认图标，可后续添加 `build.icon`
6. **代码签名：** 当前未配置，`signAndEditExecutable: false`
7. **IPC 扩展：** 新增 IPC 需同时改 `main.js`、`preload.js`，并更新本文档
8. **我的模型页：** 独立模块 `pages/my-models-page.js`，与模型仓库页渲染逻辑分离
9. **聊天导航：** 使用 `ChatUI.enterWithModel(model)`，避免 `navigate("chat")` 与 `showPicker()` 冲突

---

## 测试覆盖

```
tests/
├── core.test.js           # StorageManager、SettingsStore
├── repo-v2.test.js        # 搜索、筛选、本地扫描
├── download-engine.test.js# 分片、合并、SHA256
├── mirrors.test.js        # 镜像 URL
├── ollama.test.js         # Modelfile、名称解析
└── chat-sessions.test.js  # 会话 CRUD
```

运行：`npm test`

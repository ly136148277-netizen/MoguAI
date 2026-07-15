# Setup Hub v1.5 — 一键环境中心

> 别人只装MOGU AI Setup 时，用本页补齐 Ollama / PAI / ComfyUI。

## 入口

- 侧栏 **环境**
- 首次启动向导（`showSetupWizard`）
- 创作台顶部状态条（缺什么可点进环境页）

## 三块状态

| 组件 | 绿 | 黄 | 红 | 主按钮 |
|------|----|----|----|--------|
| Ollama | 已安装且 API 可达 | 已装未运行 | 未安装 | 一键安装 / 启动 |
| PAI 引擎 | `/health` ok | 已装未启动 | 未找到 venv | 一键安装 / 启动 |
| ComfyUI | API 在线且已写入 pai.yaml | 找到目录未写入 / 未运行 | 未找到 | 下载引导 / 扫描写入 |

## 安装策略

### Ollama

1. 优先 `winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements`
2. 失败则下载官方 `OllamaSetup.exe` 到临时目录并拉起安装程序
3. 装完后探测 `http://127.0.0.1:11434`；可点「启动」

实现：`src/main/setup-hub.js` → IPC `setup:install-ollama` / `setup:status`

### PAI 引擎

目标目录：`%LOCALAPPDATA%/ai-model-manager/pai`（或 userData/pai）

1. 扫描常见路径（含原开发机 `E:\projects\PAI`）及设置中的 `paiRoot`
2. 若无可用引擎：
   - 若配置了 `paiRuntimeUrl`：下载 zip → 解压 → `python -m venv .venv` → `pip install -r requirements.txt`
   - 否则提供「选择已有 PAI 文件夹」
3. 写入设置 `paiRoot`，后台 `pai serve`

实现：IPC `setup:install-pai` / `setup:pick-pai-root`

### ComfyUI（引导，非内嵌 GB 下载）

1. 「下载便携包」打开说明/官方页（`comfyUiDownloadUrl`）
2. 用户解压到任意盘后点「我已装好 → 扫描」
3. 复用 `env-scan.findComfyUiCandidates` + `applyComfyUiToPai`

实现：IPC `setup:open-comfy-guide` / `setup:scan-comfyui`

## 模型路径说明（与 Ollama）

- GGUF 仍下到「模型保存位置」（storage）
- 下载后自动 `ollama create`（既有链路）
- **不**把聊天 GGUF 写入 ComfyUI `models/`（两套 catalog 分离）

## IPC 草案

| Channel | 说明 |
|---------|------|
| `setup:status` | 汇总 Ollama / PAI / ComfyUI |
| `setup:install-ollama` | 一键装 Ollama（进度事件 `setup-progress`） |
| `setup:install-pai` | 一键装/绑定 PAI |
| `setup:pick-pai-root` | 文件夹选择 |
| `setup:open-comfy-guide` | 打开下载说明 |
| `setup:scan-comfyui` | 扫描并写入 |
| `setup:dismiss-wizard` | 跳过首次向导 |

## 失败处理

- 全程可重试；可「稍后」跳过（创作台对应能力灰显）
- winget 不存在时走安装包下载
- pip/venv 失败时展示日志尾部，提示安装 Python 3.11+

## 网络代理（无需设置按钮）

MOGU AI **自动跟随 Windows 系统代理**（与 v2rayN「系统代理」一致）。

- 外网下载模型 / CDN：走系统当前代理
- `127.0.0.1` / `localhost`（ComfyUI、PAI、Ollama）：**始终直连**，不进代理
- 不在设置里再加「代理开关」；要换线路请在 v2rayN / 系统设置里改，然后点环境页 **「刷新状态（含代理）」** 即可，无需重开整个软件

打开 ComfyUI 网页时额外使用浏览器 `--proxy-bypass-list`，避免 Edge 把本机地址误送进失效代理。

# MOGU AI 发版与签名指南

## 〇、两条通道必须分开（本机 ≠ 通用客户）

| | **你的电脑（本机 / 开发）** | **通用客户包** |
|--|---------------------------|----------------|
| 用途 | 自己试用、联调、看日志改 bug | 给别人安装使用 |
| 安装来源 | 本机 `dist\*.exe`、`npm start`、开发 tag（alpha/beta） | **仅** `mogu-ai-releases` 上的**稳定**安装包 |
| 账号 / Token / 密钥 | 只存在 `%APPDATA%\ai-model-manager\`（本机 userData） | **不进安装包**；用户各自在自己电脑上配置 |
| PAI 路径、电话、本地目录 | 你的设置，只影响你 | 客户自己的环境，互不相干 |
| 当前稳定基线 | 本机可跑 `v1.7.0` | **`v1.7.0`**（Skills Runtime；历史包保留 `v1.6.0` / `v1.5.5`） |

原则：

1. **打包只含程序与公开配置**（白名单 + ASAR denylist）；永不打进 `*.token`、`.env`、你的 `secrets.json`、本机路径。  
2. **登录态与密钥只在各机 userData**，换电脑不会、也不应该自动带上你的账号。  
3. **开发版 / beta** 给你自己；**通用客户**只发稳定 Release，另走审核与 `preflight:release`。

## 一、模型库 CDN 同步

### 目录结构

```
catalog/models.json     ← 在线模型库（8 个预置模型，可继续扩充）
config/repository.json  ← syncUrl 指向 CDN
```

### 发布到 CDN

1. 将 `catalog/models.json` 推送到 GitHub（例如 `mogu-map/catalog/models.json`）：

```powershell
cd D:\Project\ai-model-manager
.\scripts\publish_model_catalog.ps1          # 推送到 gh 用户下的 mogu-map
.\scripts\publish_model_catalog.ps1 -SkipPush   # 仅本地预览 .publish-mogu-catalog
```

> **勿与地图脚本混淆**：`publish_mogu_map.ps1` 推的是优惠地图；`publish_model_catalog.ps1` 推的是 **GGUF 模型库**。  
> **勿与 PAI 混淆**：PAI `/workflows/catalog` 是 ComfyUI 工作流，由管家 Agent 维护。

2. 默认 syncUrl（jsDelivr）：
   ```
   https://cdn.jsdelivr.net/gh/ly136148277-netizen/mogu-map@main/catalog/models.json
   ```
3. 用户点击「更新模型库」或启动时自动同步；CDN 不可用时回退到**安装包内置 catalog**

### 本地数据

- 合并结果写入：`%APPDATA%/ai-model-manager/models-catalog.json`
- **不会**修改安装目录内只读文件

---

## 二、自动更新（electron-updater）

### 配置

`config/update.json`（已配置 GitHub Releases）：

```json
{
  "provider": "github",
  "owner": "ly136148277-netizen",
  "repo": "mogu-ai-releases"
}
```

发版命令（基线 **v1.5.5+**；勿再分发 v1.5.4）：

```powershell
# 凭据优先：gh auth login，或本 shell 临时 GH_TOKEN（不要把长期 token 放进项目目录）
gh auth status
# 可选：$env:GH_TOKEN = "<short-lived PAT>"

npm run preflight:release   # = npm test → dist → check:asar
.\scripts\publish_mogu_releases.ps1   # 版本读 package.json
```

打包白名单必须持续排除：`config/github.token`、`*.token`、`.env`、本地配置与 `scripts/`（见 `package.json` → `build.files` 与 `build/asar-denylist.js`）。

Release：https://github.com/ly136148277-netizen/mogu-ai-releases/releases

### 应用内行为

- 设置 →「启动时自动检查软件更新」（默认开启）
- 设置 →「检查软件更新」手动触发
- 发现新版本 → 底部蓝条 → 下载 → 重启并安装

`url` 留空时跳过更新检查（开发环境默认）。

---

## 三、代码签名（Windows）

### 环境变量（推荐）

复制 `config/signing.example.env` 为本地 `.env.signing`（勿提交 git）：

```powershell
$env:CSC_LINK = "D:\certs\mogu-ai.pfx"
$env:CSC_KEY_PASSWORD = "your-password"
npm run dist
```

或使用 Base64 证书：

```powershell
$env:CSC_LINK = "base64://..."
$env:CSC_KEY_PASSWORD = "..."
```

### package.json

正式签名时可设：

```json
"win": {
  "signAndEditExecutable": true,
  "signDlls": true
}
```

当前仓库默认 `signAndEditExecutable: false`（无证书时可正常打包）。

### 证书类型

- **EV 代码签名**：SmartScreen 信任最快（需购买）
- **标准 OV 证书**：可用，新证书仍需积累信誉
- **自签**：仅内部测试，用户会看到警告

---

## 四、发版 Checklist

- [ ] `npm test` 全绿
- [ ] `package.json` 版本号 bump
- [ ] `CHANGELOG.md` 更新
- [ ] `npm run dist`
- [ ] 上传安装包 + `latest.yml` 到更新 CDN
- [ ] （可选）推送 `catalog/models.json` 到 mogu-map
- [ ] （可选）配置 CSC_LINK 后重打签名包

---

## 五、分工说明

| 模块 | 负责方 |
|------|--------|
| 模型库 / CDN / 自动更新 / 签名 | 桌面端（本仓库） |
| 内置 PAI / ComfyUI 能力扩展 | 管家 Agent / PAI 团队 |

# MOGU AI 发版与签名指南

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

发版命令：

```powershell
npm run dist
.\scripts\publish_mogu_releases.ps1 -Version 1.4.0
```

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

# GitHub Pages 部署说明
# docs/ 目录包含 map.html、deals_today.json、map_config.js

## 一键部署（推荐：独立仓库 mogu-map）

```powershell
cd D:\Project\ai-model-manager
gh auth login
.\scripts\publish_mogu_map.ps1
```

脚本会自动：生成 `deals_today.json` → 创建公开仓库 `mogu-map` → 推送 → 开启 GitHub Pages。

## 部署后

1. 访问 `https://<你的用户名>.github.io/mogu-map/map.html`
2. 在高德开放平台将该域名加入 **Web 服务** 白名单
3. 把完整 URL 填入 `config/mogu_deals_news.json` 的 `map_page_url`
4. 再次运行 `python mogu_deals_push.py`，微信推送末尾会出现地图链接

## 文件说明

| 文件 | 说明 |
|------|------|
| map.html | 高德地图页（微信内打开） |
| deals_today.json | 每日优惠坐标（脚本自动生成） |
| map_config.js | 高德 Key（脚本自动生成，勿提交公开仓库时可 gitignore） |

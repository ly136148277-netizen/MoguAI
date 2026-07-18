# 运维脚本与主线分离

新闻推送、优惠地图、微信域名等脚本**不属于** MOGU AI 桌面端主线。

已迁至兄弟目录：

```text
D:\Project\mogu-news-ops\
```

MOGU 安装包 / `app.asar` 不得包含上述内容。发版请用：

```powershell
npm run preflight:release
```

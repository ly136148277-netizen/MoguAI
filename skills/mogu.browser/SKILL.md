# mogu.browser

## 何时使用
- 打开网页给用户看
- 抓取公开页面正文供大脑总结
- 本机已装 Playwright 时做简易渲染抓取

## 操作
- `status` / `preflight`
- `open`：系统默认浏览器打开 `{ url }`
- `fetch`：HTTP 拉取 HTML 并抽正文（无 JS）
- `run`：`{ url, engine: "fetch"|"open"|"playwright" }`

## 权限
- `open` / `fetch` / `status`：L1
- `run` + playwright：L2

## 环境
- Playwright **不打进安装包**；可选 `browserPlaywrightPath` 或 vendor 旁路
- 无 Playwright 时用 `open` / `fetch` 即可

## 禁止
- 不内嵌完整浏览器 IDE
- 不自动填写密码/支付

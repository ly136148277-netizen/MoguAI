# mogu.browser

## 何时使用
- 打开网页给用户看
- 抓取公开页面正文
- 点击 / 填表 / 多步办事（需本机 Playwright）

## 操作
- `status` / `preflight`：含 Playwright 探测与可复制安装命令
- `open`：系统浏览器打开 `{ url }`
- `fetch`：HTTP 抽正文（无 JS）
- `act`：`{ steps: [{action,url?,selector?,value?,ms?,key?}] }` Playwright 多步
- `click` / `fill` / `extract`：单步快捷写法
- `run`：`engine=fetch|open|playwright`

### steps.action
`goto` · `click` · `fill` · `extract` · `wait` · `press`

## 权限
- `open` / `fetch` / `status` / `extract`(http)：L1
- `act` / `click` / `fill` / playwright `run`：L2

## 环境
- Playwright **不打进安装包**
- 安装：`npm i -D playwright` 后 `npx playwright install chromium`
- 或设置 `browserPlaywrightPath` / vendor 旁路

## 禁止
- 不自动过验证码 / 支付
- 不内嵌完整浏览器 IDE

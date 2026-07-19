# mogu.search

## 何时使用
- 需要联网查实时事实、新闻、文档链接
- 大脑回答前要先核实公开信息

## 操作
- `status` / `preflight`：后端可用性
- `query` / `run`：`{ query, limit? }`

## 权限
- 默认 L1（只读网络）

## 环境
- DuckDuckGo Instant Answer API，无需单独 API Key
- 使用大脑通道时由大脑自动调用

## 禁止
- 不抓取需登录的私有页面（用 mogu.browser + 用户本机会话）

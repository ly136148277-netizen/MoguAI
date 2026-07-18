# v1.6 Beta Soak

开发通道验收。**不**制作普通用户稳定安装包；`v1.5.5` 仍为用户基线。

## 自动门禁

```bash
npm run soak:beta
```

包含：

- 全量 `npm test`（含 `tests/beta-soak.test.js`）
- Mock Gateway 对话往返 / 断线恢复 / 精确取消
- 已接受超时不降级 PAI
- L3 无 UI 拒绝、有确认才放行
- 四源任务列表 + 公共载荷去 token
- 诊断包不含 `secrets.json`
- 生命周期状态分类

## 手工 soak（上稳定前必做）

| # | 场景 | 通过标准 |
|---|------|----------|
| 1 | 本机真实 Gateway 连接 | OpenClaw 页显示 `connected`，设置中 token 仅主进程 |
| 2 | Agent 选 OpenClaw 发一条消息 | 流式回复 + TaskStore 有 `moguTaskId` + 终态 |
| 3 | 运行中断网/杀 Gateway 再连 | 任务可 `recover`，无重复任务、无错误终态回写 |
| 4 | L3「删除…」 | 必现确认框；取消则不执行；审计有记录 |
| 5 | 任务中心 | 可按来源/状态筛选；精确取消；失败可 retry |
| 6 | 数据中心 | 扫描有占用；导出诊断包无 token/密钥 |
| 7 | 降级铁律 | Gateway 已接受后等待超时 **不** 自动改走 PAI |

## 版本关系

```text
v1.5.5           稳定用户版
v1.6.0-alpha.*   Bridge / 任务 / 权限 / 数据中心开发切片
v1.6.0-beta.*    soak 通道（本文件）
v1.6.0           稳定版（soak 通过 + preflight:release 后另发）
```

## 明确不做（beta 仍后置）

- 外部渠道（Telegram 等）
- Gateway 自动安装 / 内嵌 Runtime
- Skills 市场

## 稳定切割条件

1. `npm run soak:beta` 全绿  
2. 上表手工 1–7 签字  
3. `npm run preflight:release`（test → dist → check:asar）  
4. 文档 / 版本号 / ASAR 一致  
5. **另打** `v1.6.0` tag 与用户安装包（勿覆盖 `v1.5.5` 认知，直到宣布切换）

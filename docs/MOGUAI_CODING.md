# MOGU AI 编程（工人 + 精密工厂）

这是 **MOGU AI 自有编程能力**。

## 两层

| 层 | 名称 | 作用 |
|----|------|------|
| 工人 | `mogu.coding` · `moguai_a` / `moguai_b` | 规则注入、自动验修、review/hunk、双引擎对比、commit、verify |
| 工厂 | **MOGU AI 精密工厂** | 本机轻量工位：文件树、编辑、diff/hunk、再派工、双引擎对比 |

```text
大脑 → 派工 → 工人改仓库
              ↓
         精密工厂：看改动 / 打开文件 / 手改 / 再派工
```

精密工厂是自有轻量工位（Monaco）：

- **补全 / 诊断 / 跳转定义**：JS/TS（Monaco 语言服务 + 工作区文件索引）
- **调试**：Node `.js/.mjs/.cjs`（inspect + 断点 / 继续 / 单步 / 变量）
- 其它语言可编辑，完整 LSP/多语言调试后续再加

## 引擎（工人）

| 产品名 | 引擎键 | 入口 | 运行时子目录 |
|--------|--------|------|--------------|
| MOGU AI 编程 · 引擎 A | `moguai_a` | `moguai-coding-a` | `moguai-runtime-a` |
| MOGU AI 编程 · 引擎 B | `moguai_b` | `moguai-coding-b` | `moguai-runtime-b` |

应用在用户目录自动创建：

```
<应用 userData>/moguai-runtimes/
  moguai-runtime-a/
  moguai-runtime-b/
```

**官方拉取 + 适配钉扎**（设置 → MOGU AI 编程）：

- **检查更新**：显示本机版本 / 当前适配官方版 / 官方最新
- **安装/升级**：只拉取应用已适配的官方版本，写入上述目录并生成 `moguai-coding-a/b` 入口
- 若官方最新大于适配版：仅提示「官方已有 x，当前适配 y」，不盲升
- 适配表：`config/moguai-runtime-compat.json`（抬适配版随应用发版）

未安装引擎时仅「编程」不可用；对话 / 出片 / 联网正常。精密工厂在有工作区时仍可浏览与手改文件。

## 改码能力（相对「只派工」）

1. **项目规则**：读取 `.moguai/rules.md` / `AGENTS.md` 等注入 prompt，并附仓库顶层速览  
2. **改对位置**：轻量符号/引用索引 → 目标文件计划（含一跳 import）；写入派工约束并锁定  
3. **改对内容**：硬约束最小改动；改后检查 diff 是否触及任务要点，跑偏则自动内容纠偏  
4. **文件集锁定**：越界改动默认 **回滚拦截**（工厂可关；可手填锁定列表）  
5. **自动验修**：有 test 脚本时改完自动测，失败带着日志再修（最多 2 轮）  
6. **Hunk 审阅** / **双引擎对比**：细粒度接受；A/B 取优时计入内容与越界惩罚  

## 精密工厂用法

- 侧栏 **精密工厂**，或对话任务卡 **在精密工厂打开**（带派工说明）
- 选择工作区 → **派工人** / **双引擎对比** → 按文件或 **hunk** 接受/拒绝 → 提交 / 跑测试
- 勾选 **自动验修**（默认开）：有测试则红了再修
- 勾选 **越界拦截**（默认开）：可填「锁定文件」；留空则从派工说明推断，越界自动回滚
- 派工中可 **取消**；失败可看输出末尾日志，再派工或手改
- 侧栏 **搜索**文件名/符号；调试支持 **调用栈**、**条件断点**（Alt+点行号槽）
- 引擎 B 依赖失败：设置里 **重试引擎B依赖**（需本机已装 uv）

## 公开评测（仅测试准确率）

用 [SWE-bench Lite](https://huggingface.co/datasets/SWE-bench/SWE-bench_Lite) 公开题**自测准确率**（不喂 gold patch）：

```bash
npm run bench:swe:fetch -- --limit 5          # HF 不通会回退 sample
npm run bench:swe:run -- --limit 5
npm run bench:swe:eval -- --run-id <id>       # 需 Docker + pip install swebench
```

说明见 `benchmarks/swe-bench/README.md`。

## Skill

`mogu.coding`；模块：`src/main/moguai/coding/`、`src/main/skills/coding-power.js`、`src/main/moguai/factory/`。

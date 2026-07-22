# 编程能力 / SWE 自测存档（2026-07-19）

> 进度快照，方便下次接着做。不含任何 API Key。  
> **交任务表（新聊天挂这个）**：[`docs/HANDOFF_AUTONOMY.md`](./HANDOFF_AUTONOMY.md)  
> 总档：[`docs/PROJECT_AUTONOMY_ROADMAP.md`](./PROJECT_AUTONOMY_ROADMAP.md)

## 目标

用公开数据把 MOGU 编程准确率做起来；终态为 **Cursor 只传达 / MOGU 全自动**（见总档验收线）。

## 自治收尾轮（2026-07-19 晚）

- 入口：`mogu.coding` / `dispatch`；多轮 SEARCH/REPLACE + 可选 FAIL_TO_PASS verify  
- 跑次：`lite8-autonomy-20260719` → 合并 `lite8-autonomy-merged`  
- **官方 Resolved：0/8**（未达 ≥2/8）  
- 详见 `benchmarks/swe-bench/runs/lite8-autonomy-merged/OFFICIAL_EVAL.md`

## 已完成

### 产品能力
- 质量预警 + 自动 verify/再修
- hunk 接受/拒绝、项目规则注入、双引擎对比
- 文件 scope 锁 + 越界 trim（`coding-scope.js`）
- 改对位置/内容（`coding-accuracy.js`）
- **本地 Ollama 补丁路径**（`coding-local-patch.js`）：SEARCH/REPLACE、`think:false`、按符号聚焦文件、空改检测

### 公开基准
- SWE-bench Lite harness：`npm run bench:swe:fetch|run|eval`
- 缓存 8 题：`benchmarks/swe-bench/cache/tasks.json`
- 私有自测骨架：`benchmarks/private/`（只接受自有题，拒 Cursor/Trae 私有数据）
- 合法公开 distill 脚手架：`benchmarks/distill/`

### 实测结果（本机）

| 跑次 | 模型/路径 | 结果 | 产物 |
|------|-----------|------|------|
| `lite8-ollama-patch-20260719` | Ollama 早期 unified-diff | 基本失败（补丁损坏），已中止 | 作废 |
| **`lite8-sr-20260719`** | `qwen3:8b` + local SEARCH/REPLACE | **5/8 非空补丁**；引擎 ok 7/8 | `benchmarks/swe-bench/runs/lite8-sr-20260719/` |

说明：5/8 只是「有补丁」，**不是**官方 Resolved。小模型改动经常逻辑不对。

### 中转账号（状态）

| 代号 | 地址 | 状态（2026-07-19） | 决策 |
|------|------|-------------------|------|
| **旧家（弃用）** | `https://wecodex.lol/v1`（本机 Codex/`PROXY_API_KEY`） | 欠费约 -$0.21；慢；宣传额度不可信 | **不用了** |
| **新家（今天截图）** | `https://ai-api-router.manylisten.ccwu.cc/v1` | 余额约 **$2**；chat 通；SWE 8 题 **6/8 非空补丁**（`lite8-manylisten-20260719`）；详见 `docs/RELAY_MANYLISTEN_REPORT.md` | **只用这家** |
| 官方 OpenAI | `api.openai.com` | 中转 key 无效 | 非目标 |

### 代码/测试
- 相关单测通过（全仓约 204）
- Bench 已固定：`codingIgnoreUserConfig=true`，云端默认 `OPENAI_BASE_URL` / `MOGU_API_BASE`

## 未完成 / 堵住（2026-07-19 收尾后）

1. ~~新家 chat~~ ✅  
2. ~~云端 SWE 8 题过程跑~~ ✅ 合并后 **8/8 非空补丁**（`lite8-manylisten-merged`）  
3. ~~定位噪音（.dat/.fits）~~ ✅ 已降权；失败 2 题重跑成功  
4. ~~三角对比报告~~ ✅ `docs/RELAY_MANYLISTEN_REPORT.md`  
5. ~~官方 Resolved~~ ✅ 已跑完  
   - Docker 已开；去 daocloud 镜像源；Win `resource` stub + swebench 4.1.0  
   - **Resolved = 0/8（0%）** → 详见 `benchmarks/swe-bench/runs/lite8-manylisten-merged/OFFICIAL_EVAL.md`  
6. Codex 全引擎挂起：已用 `MOGU_CLOUD_PATCH=1` 绕过；全工具环仍待修（非阻塞）  
7. （可选）扩 Lite 题量；旧家别充  
8. **不宣称超越 Cursor**，直到有 Resolved %

## 关键文件

- `src/main/skills/coding-local-patch.js`
- `src/main/skills/handlers/coding.js`
- `src/main/skills/coding-scope.js` / `coding-accuracy.js` / `coding-power.js`
- `scripts/bench_swe_run.js` / `bench_swe_lib.js` / `bench_swe_eval.js`
- `docs/MOGUAI_CODING.md`
- `benchmarks/swe-bench/README.md`

## 红线

- 不采集 Cursor / Trae 非公开私有数据集  
- Key 不写入仓库；只用环境变量

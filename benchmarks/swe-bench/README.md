# SWE-bench Lite（公开自测）

用公开题库 [SWE-bench Lite](https://huggingface.co/datasets/SWE-bench/SWE-bench_Lite) **只测自己的准确率**，不是搬别人产品。
脚本**不会**把 gold patch 喂给引擎；官方 harness 才负责判对错。

## 流程

```text
拉题 → MOGU 在 base commit 上改码 → 导出 patch → 官方 Docker harness 判对错
```

## 前置

1. **Git**、**Node 18+**
2. **编程引擎已安装**（设置里装 moguai A/B），且大脑 API Key 可用
3. **正式打分**还需：**Docker** + Python `swebench`（磁盘建议 ≥120GB，内存建议 ≥16GB）

## 命令

在仓库根目录：

```bash
# 1) 拉前 N 道题（默认 5；HF 不通会自动用仓库内 sample）
npm run bench:swe:fetch -- --limit 5
# 或强制本地样例：
npm run bench:swe:fetch -- --sample

# 2) MOGU 跑题，写出 predictions.jsonl + metrics.json
npm run bench:swe:run -- --limit 5

# 只演练流程、不调引擎：
npm run bench:swe:run -- --limit 2 --dry-run

# 3) 官方 harness 打分（需 Docker + pip install swebench）
npm run bench:swe:eval -- --run-id mogu-lite-1
```

环境变量（可选）：

| 变量 | 含义 |
|------|------|
| `MOGU_API_KEY` / `OPENAI_API_KEY` | 云端密钥；不设则默认走本机 Ollama |
| `MOGU_USE_OLLAMA=1` | 强制本机 Ollama；本地小模型走 `local_ollama_patch`（SEARCH/REPLACE，`think:false`） |
| `MOGU_LOCAL_PATCH=0` | 关闭本地补丁路径，改走完整 Codex/引擎工具循环 |
| `OLLAMA_MODEL` / `--model` | 默认 `qwen3:8b` |
| `MOGU_BENCH_ENGINE` | `moguai_a`（默认）或 `moguai_b` |
| `MOGU_BENCH_WORKDIR` | 克隆工作目录，默认 `benchmarks/swe-bench/work` |

本地示例：

```bash
# 需本机 ollama serve，且已 pull 模型
npm run bench:swe:run -- --limit 1 --ollama --model qwen3:8b --run-id lite1-local
```

## 产出

| 文件 | 内容 |
|------|------|
| `cache/tasks.json` | 拉到的题目 |
| `runs/<runId>/predictions.jsonl` | SWE-bench 格式补丁预测 |
| `runs/<runId>/metrics.json` | MOGU 侧指标（文件数、scope、耗时等） |
| `runs/<runId>/summary.md` | 可读摘要 |

官方评测通过率（Resolved）才是和公开榜可比的分数；`metrics.json` 只是过程指标。

## 和 Cursor 比

1. 同一 `tasks.json`、同一 `instance_id` 列表
2. Cursor 侧自行导出 patch，转成同样的 `predictions.jsonl`
3. 两边都用 `bench:swe:eval` 打分，比 **Resolved %**

## 注意

- Lite 全量 300 题；先 `--limit 5` 冒烟，再加大
- 勿把 gold `patch` 喂给模型；本脚本不会这么做
- 评测镜像很大，第一次拉取很慢，属正常

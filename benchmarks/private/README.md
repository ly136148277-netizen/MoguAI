# 私有对打题（仅你们自有数据）

这里放**本团队 / 客户授权**的内部任务，用于准确率自测。
**不要**放入 Cursor、Trae 或其它厂商的未公开题库。

格式与公开 SWE-bench 流水线对齐，方便同一套脚本记分。

## 目录

```text
benchmarks/private/
  README.md
  schema.json          # 题目字段说明
  tasks.example.json   # 示例（可复制为 tasks.json）
  tasks.json           # 你们的题（默认 gitignore，勿提交密钥/客户代码）
  runs/                # 跑分产出
```

## 用法

```bash
# 校验题目格式
npm run bench:private:validate

# 干跑（只检查 checkout/prompt，不调引擎）
npm run bench:private:run -- --limit 2 --dry-run

# 实跑（需引擎 + API Key）
npm run bench:private:run -- --limit 5
```

每道题应自备：`workspace`（本机已有仓库路径）或 `repo`+`base_commit`（可 clone 的公开/已授权仓库）。
成功标准写在 `success` 里（例如要跑的测试命令）。

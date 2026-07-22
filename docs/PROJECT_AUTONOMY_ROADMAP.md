# MOGU 自治总档

> 更新：2026-07-21 · **S3.4 Pass 已封存** · Post-S3 目标已收紧  
> 不含 API Key。  
> **权威结案**：[`S3_4_HANDOFF_CLOSEOUT.md`](./S3_4_HANDOFF_CLOSEOUT.md)  
> **研究 / 下一阶段**：[`RESEARCH_BACKLOG_POST_S3.md`](./RESEARCH_BACKLOG_POST_S3.md)  
> **日常接续**：[`HANDOFF_AUTONOMY.md`](./HANDOFF_AUTONOMY.md)

---

## 产品定位（Post-S3）

> **MOGU 的目标不是拥有最强模型，而是成为一个能在统一条件下，持续提升模型完成真实工程任务能力的工具平台。**

关键词：**统一条件** · **持续提升** · **真实工程任务**。

评价标准始终是：

> **工具给模型带来了什么可重复、可归因的增益。**

而不是「模型本身有多强」。

一句话目标（证据边界内）：

> **让任何模型插上 MOGU 的工具栈，都能在统一实验条件下获得可重复、可归因的性能提升。**

「X 个百分点」等数字，等 A1 / 公开对照完成后再写；现在不预承诺。

### 「统一条件」不是口号——踩坑注脚

这些是已用真实教训换来的操作纪律（详见 Backlog / 实验报告）：

1. **曾把跨模型结果算进同一组 k=N**（混模凑数）→ 禁止；中途 503 整组作废或整组提前改模声明。  
2. **曾把拼接 / BoN any-pass 写进回归基线** → R_reg 与 BoN **分账**；结案数字不 silent 改写。  
3. **曾把单次 Resolved 当实锤 / 模型贡献** → 未同模复现则标 **unreplicated observation**，不升级证据。  
4. **曾把不同协议锚点做成「谁更正宗」排行** → 三表并立（Official 3/8 · Engineering 6/8 · R_reg@gpt-5.5）；职责分离。  
5. **曾把「中转代号更接近公开榜」当成选模理由** → 公开同台看 **协议 + 官方模型身份**；内部规模化另选稳/省模型。

---

## 传达-only 终态（S3.4 已满足）

```text
你下指令 → Cursor 只 invoke mogu.coding → MOGU 全自动改仓库/验修 → 回报结果
```

Cursor **不**手写业务补丁、不代改仓库。

| | |
|--|--|
| 工程验收 S3.4 | **Pass（已封存）** |
| Engineering Baseline | **`R_reg = 6/8`**（sol 合入栈） |
| Official Anchor | phase1-anchor **3/8**（sol；横向参照） |
| R_reg@gpt-5.5 | A0 **5/8**（独立基线） |

---

## Post-S3 阶段排序（排期 ≠ 能力预测）

| 阶段 | 内容 | 目标 | 注意 |
|------|------|------|------|
| **P1 工程能力** | 受控任意终端 · LSP Diagnostics · 长轨迹记忆 · 自适应重试 | **补齐工具能力** | 「4–6 周」若作排期，只表示开发完成窗口；**≠**「进入第一梯队」 |
| **P2 验证能力** | A1≈300 @gpt-5.5 · 同模同配置同环境 · 证据纪律 | 回答：**工具带来多少可重复增益？** | 300 题把证据从样例级升到**有代表性的系统级证据**；**≠**证明「最强工具」 |
| **P3 产品能力** | 默认策略 · 模型路由 · BoN 产品化 · 对外报告 | 仅当 P2 显示稳定增益后再开 | 不做未验证的能力宣称 |

收益大小需实验验证，不默认「四项都会显著提升」。

---

## 只传达用法

```js
await skills.invoke("mogu.coding", "dispatch", {
  workspace: "D:/path/to/repo",
  prompt: "用户原话任务",
});
```

```powershell
$env:OPENAI_API_KEY = "<新家key>"
$env:OPENAI_BASE_URL = "https://ai-api-router.manylisten.ccwu.cc/v1"
$env:MOGU_CLOUD_PATCH = "1"
# 实验主力见 POST_S3_EXPERIMENT_POLICY（当前规模化默认 gpt-5.5）
$env:MOGU_BENCH_MODEL = "gpt-5.5"
```

---

## 关联路径

- 结案（封存）：`docs/S3_4_HANDOFF_CLOSEOUT.md`
- 研究 Backlog：`docs/RESEARCH_BACKLOG_POST_S3.md`
- 实验策略：`docs/POST_S3_EXPERIMENT_POLICY.md`
- 交任务表：`docs/HANDOFF_AUTONOMY.md`

## 红线

- 不宣称「全面超过 Cursor / 第一梯队」除非有公开评测支撑  
- 不改写已封存结案；研究进 Backlog  
- Key / 竞品私有数据不进仓库  
- 排期数字不作能力预测；300 题不作「最强」证明  

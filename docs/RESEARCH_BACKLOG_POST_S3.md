# Post-S3 研究课题 Backlog

> 与 [`S3_4_HANDOFF_CLOSEOUT.md`](./S3_4_HANDOFF_CLOSEOUT.md) **分文件存放**。  
> S3.4 已 Pass；本清单可增删，**不**回写结案结论。  
> 更新：2026-07-21 · 目标定义 + 踩坑注脚 + P1/P2/P3；A0 已完成

---

## 目标（绑定「统一条件」）

> MOGU：**工具平台**，不是最强模型。在**统一条件**下，持续提升模型完成真实工程任务的能力。  
> 详述与排期边界见 [`PROJECT_AUTONOMY_ROADMAP.md`](./PROJECT_AUTONOMY_ROADMAP.md)。

**「统一条件」踩坑注脚（勿退化成空话）：**

| # | 曾犯 | 现行纪律 |
|---|------|----------|
| 1 | 跨模型结果算进同一组 k=N | 禁混模；503→整组作废或整组提前改模 |
| 2 | BoN / 拼接写进 R_reg | 分账；结案数字不 silent 改写 |
| 3 | 单次 Resolved 当模型贡献实锤 | unreplicated observation；要同模 k≥3 |
| 4 | 3/8 vs 6/8 排「谁更正宗」 | 三表并立，职责分离 |
| 5 | 「选 sol 更接近公开榜」 | 内部规模化看稳/省；公开同台另开 B-ext |

## 原则

- 不阻塞 S3.4；实例级归因；BoN ≠ R_reg；禁混模凑 k=N。  
- 措辞不超过证据（用「未复现 / 证据不足」，不用「噪声/丢弃/已证明等价」）。  
- **排期 ≠ 能力预测**；**300 题 = 证据升级，≠「最强工具」证明**。

## Post-S3 工作流

| 阶段 | 内容 | 状态 |
|------|------|------|
| **P1** | 受控终端 · LSP Diagnostics · 长轨迹记忆 · 自适应重试 | 待排期（工程补齐） |
| **P2** | B1→B2（≈300 @gpt-5.5）；同模同配置；量工具增益 | B1 待开 |
| **P3** | 默认策略 / 路由 / BoN 产品化 / 对外报告 | **P2 出稳定增益前不开** |

---

## 已关闭

| ID | 课题 | 结论 | 状态 |
|----|------|------|------|
| R1 | 14182 @ gpt-5.5 k=3 | 0/3 | **Closed** |
| R1b | 14182 @ gpt-5.6-sol k=3 | 0/3；历史单次 C = **unreplicated observation**；不升级证据；不进 R_reg；**不作为模型贡献证据** | **Closed (Negative Result)** |
| R2 | 14365 @ gpt-5.5 k=5 | 3/5，仍 **High Variance**；BoN 可选假设仍仅 1 个 HV 样本 | **Closed**（产品化另等更多 HV） |

合读：`benchmarks/swe-bench/runs/post_s3/r1b_14182_sol_k3/RESULTS.md`

| 实例 | 当前分类 |
|------|----------|
| 14365 | High Variance |
| 14182 | Unreplicated Success / 当前未复现 |

---

## 开放 Backlog

| ID | 课题 | 动机 | 前置 / 注意 | 状态 |
|----|------|------|-------------|------|
| **A0** | **R_reg@gpt-5.5 全量锚点（lite8×1）** | 单模型干净口径，与结案 `R_reg=6/8`（sol 栈）分账 | `a0_rreg_gpt55/RESULTS.md`：**5/8**；7746 掉绿；不覆写结案；停在 instance-level | **已完成** |
| R2b | 14182 Hints D（可选） | Hints 仍 Unmeasured | 14182 已退出模型贡献主线；低优先级 | 搁置 |
| R3 | Targeted BoN 产品化 | HV 自动 N=3 | 需 **第二个 HV 实例** 后再深挖；勿在 14365 单题加码 | 待办 |
| R4 | Hard Fail × BoN | 验证 HF 不宜先 BoN | 需真实 HF；14182 ≠ HF 样板 | 待办 |
| R5 | 更多 HV 复测 BoN | 假设→规律 | 新 HV 题 | 待办 |
| R6 | `test_roundtrip` / `test_rst_with_header_rows` 根因 | 失败名已记 | **搁置**；全量后再作二级诊断参考 | 搁置 |
| R7 | LSP 全量 | 超越 find_refs | 单独门禁 | 待办 |
| R8 | 多模型 system 对照 | 斜率 | 对「单模型单次通过」提高警惕（R1/R1b 教训）；需多模型 key | 待办 |
| R9 | 中转可用性 | sol 抖动 | 探活脚本已有 | 持续 |
| B1 | Lite 抽 50 探路（**Coverage**） | 暴露规模化基建坑 | **Archived**：`R_scale@gpt-5.5_n50` = **24/50** Resolved；Unresolved 8 · Empty 0 · **Error 18**（eval 镜像拉取/404）；A0 交集空；见 `b1_lite50/COVERAGE_REPORT.md`。P1 缺口**勿**用通过率区间对号——优先处理 Error 镜像基建后再谈语义桶 | **已完成 / Archived** |
| B2-D2 | django 上结构化 retry CT | 失败反馈已知时，强制 retry 能否抬 Resolved | RESULTS：1/4 improvement → **Branch C**；hash=`3ca4933b3ca2` | **Archived · Branch C** |
| **B2-D2′** | **hypothesis diversity constraint** | H-info：显式多样假设能否抬 Resolved | 计数 Branch **B**；机制 **inconclusive/mixed**（12497 无 diversity 周期） | **Archived** |
| **Feedback-B** | **P1–P3 反馈打包 CT** | 失败信息质量 | Branch **A** (2/3)；M6=M7=0/9 → util Not Confirmed | **Archived** |
| **Feedback-Consumption** | 强制消费门闩 | 信息是否进决策 | Branch **B** (1/3, F)；13265 R 皆 first-shot → util Not Confirmed | **Archived** |
| **Cross-synthesis** | 排除链收束 | 瓶颈在 decision grounding | `controlled_trials/CROSS_EXPERIMENT_SYNTHESIS.md` | **Complete** |
| **Capability probe** | baseline 新题 k=3 | 熟脸 vs 广谱 | `capability_boundary_probe/RESULTS.md`：Slot C 再 apply=0/3 → 广谱侧 | **Complete** |
| **EPB / Decision Binding** | Evidence→Patch Binding | 补丁是否绑定失败证据 | Spec Review PASS；`MOGU_EVIDENCE_PATCH_BIND`；DB0–DB4；n=5 Gate OPEN；CT blocked until Gate close | **Impl / Smoke next** |
| D3 | 反馈质量（广义） | 与 Feedback-B 合流 | — | Deferred |
| D1 | 非 django 补 verify | 基建扩池（非 CT） | `D1_VERIFY_COVERAGE_INFRA.md`；不与策略 CT 混跑 | Candidate |
| D3 | 反馈质量（广义） | 与 Feedback-B / 原则文档合流 | Feedback-B 冻结后并入 | Deferred |
| B-ext | 官方模型公开协议对标 | 真·外部同台 | 需官方 Claude/GPT key + 协议对齐；与 B1/B2 **分规划、分跑批** | 待办 / 未立项 |

---

## 三表并立（只读 + A0）

| 表 | runId | 模型 | Resolved | 职责 |
|----|-------|------|----------|------|
| Official Anchor | `lite8-phase1-anchor-20260720` | gpt-5.6-sol | **3/8** | 横向/原生参照；解读准则见该目录 `ANCHOR_COMPARE.md` 文首 |
| Engineering Baseline | `lite8-phaseX-regression-20260720` | gpt-5.6-sol + 合入栈 | **6/8** 结案 R_reg | 工程闭环验收 |
| R_reg@gpt-5.5 | `lite8-a0-rreg-gpt55-20260721` | gpt-5.5 | **5/8** | 独立基线；不覆盖上两表；见 `post_s3/a0_rreg_gpt55/RESULTS.md` |

三者**无**「谁更正宗」优先级。A0 已完成；默认换脑仍待 Pattern 级证据，不因 7746 单点启动。

### 全量选模纪律（B1/B2）

**不**用「谁更接近公开榜」选 sol vs 5.5——中转代号与榜上 Claude/GPT **不是同一回事**；可比性取决于**协议 + 官方模型身份**，不取决于中转别名。

B1/B2 选模看：**(1) 稳定性（sol 易 503）(2) 成本** → 当前优先 **`gpt-5.5`**。  
真·公开同台 → 单开 **B-ext**。

---

## 建议下一刀（已拍板）

**选 A（先规模化），执行顺序：B1（50）→ B2（300）**；P1 工具并行设计、不混进 B1 变量。  
理由：一次只变规模；避免「新工具 bug」与「300 基建坑」纠缠。

1. **CT integrity_v1 / B2-D2** — Archived · Branch C（不变）  
2. **开源原则** — Done（P1–P7）  
3. **B2-D2′ Archived** — 计数 Branch B；机制 inconclusive（`DIAGNOSIS_BRANCH_B.md`）  
   - 已排除：单纯 retry、单纯禁重复；P7 未证实  
4. **Next：Feedback-B Spec Review** — `b2_feedback_b/EXPERIMENT.md` / `FEEDBACK_B_EXPERIMENT.md`  
   - Review PASS 前：禁止实现 / 冒烟 / CT  
   - n=3 Branch 映射已预注册；第 4 题搜寻失败已记录  
5. **D1 / 产品化** — 单列  
6. B1 / Error / 分桶 / integrity / audit 均 Archived，不动  

---

## 参考路径

- 结案：`docs/S3_4_HANDOFF_CLOSEOUT.md`  
- 策略：`docs/POST_S3_EXPERIMENT_POLICY.md`  
- R1/R1b/R2：`benchmarks/swe-bench/runs/post_s3/`  
- 结案基线：`runs/lite8-phaseX-regression-20260720/`  
- 历史硬锚：`runs/lite8-phase1-anchor-20260720/`  

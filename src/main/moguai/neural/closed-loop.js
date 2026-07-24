/**
 * MOGU 2.2 bounded closed-loop executor.
 * In-task repair iterations only — never Gateway replay / auto-resubmit.
 *
 * Flow: checkpoint → execute → verify → classify → replan → retry → review → terminal
 */

const { OUTCOMES, REASONS, reason } = require("./contracts");
const { classifyVerifyFailure } = require("../../skills/coding-d2-retry");

const TERMINAL = Object.freeze({
  SUCCEEDED: "SUCCEEDED",
  BLOCKED: "BLOCKED",
  FAILED: "FAILED",
  EXHAUSTED: "EXHAUSTED",
});

const STOP_REASONS = Object.freeze({
  VERIFIED: "verified",
  GATEWAY_ACCEPTED_NO_RESUBMIT: "gateway_accepted_no_resubmit",
  PERMISSION_DENIED: "permission_denied",
  BUDGET_REPAIR_EXHAUSTED: "budget_repair_exhausted",
  BUDGET_WALL_TIME: "budget_wall_time",
  BUDGET_STEPS: "budget_steps",
  BUDGET_TOOL_CALLS: "budget_tool_calls",
  BUDGET_COST: "budget_cost",
  COST_UNKNOWN: "cost_unknown",
  REPLAN_BLOCKED: "replan_blocked",
  EXECUTE_FAILED: "execute_failed",
  VERIFY_FAILED: "verify_failed",
});

/** Module-level last outcome for thin read-only IPC. */
let lastOutcome = null;

function closedLoopEnabled(settings) {
  return settings?.v22NeuralLayer === true && settings?.v22ClosedLoop === true;
}

function getClosedLoopStatus() {
  return {
    ok: true,
    lastOutcome: lastOutcome
      ? {
          status: lastOutcome.status,
          reason: lastOutcome.reason,
          code: lastOutcome.code || null,
          moguTaskId: lastOutcome.moguTaskId || null,
          repairIterations: lastOutcome.repairIterations ?? null,
          attempts: lastOutcome.attempts ?? null,
          finishedAt: lastOutcome.finishedAt || null,
        }
      : null,
  };
}

function recordOutcome(outcome) {
  lastOutcome = {
    ...outcome,
    finishedAt: outcome.finishedAt || new Date().toISOString(),
  };
  return lastOutcome;
}

function resetClosedLoopStatusForTests() {
  lastOutcome = null;
}

function isGatewayAccepted(context = {}) {
  if (context.requestAcceptedByGateway === true) return true;
  if (context.acceptance === "accepted") return true;
  if (context.gatewayAccepted === true) return true;
  const replayKind = String(context.replayKind || context.replay?.kind || "");
  if (/^openclaw[._]/i.test(replayKind)) return true;
  return false;
}

function permissionAllowed(decision) {
  return decision === true || decision?.allowed === true;
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeBudget(budget = {}) {
  return {
    maxRepairIterations: finiteOrNull(budget.maxRepairIterations),
    maxSteps: finiteOrNull(budget.maxSteps),
    maxToolCalls: finiteOrNull(budget.maxToolCalls),
    maxWallTimeMs: finiteOrNull(budget.maxWallTimeMs),
    maxCostUsd: finiteOrNull(budget.maxCostUsd),
  };
}

function defaultClassifyFailure(verifyOut) {
  const output =
    verifyOut == null
      ? ""
      : typeof verifyOut === "string"
        ? verifyOut
        : verifyOut.output ?? verifyOut.log ?? "";
  const classified = classifyVerifyFailure(output);
  return {
    kind: classified.class,
    class: classified.class,
    failedStage: classified.failedStage,
    detail: classified.detail,
    stages: verifyOut?.stages,
    permissionDenied: Boolean(verifyOut?.permissionDenied),
  };
}

function usageFromResult(result, previous = {}) {
  const steps =
    Number(result?.steps ?? result?.agentSteps ?? result?.usage?.steps ?? 0) || 0;
  const toolCalls =
    Number(
      result?.toolCalls ??
        result?.usage?.toolCalls ??
        (Array.isArray(result?.toolsUsed) ? result.toolsUsed.length : 0)
    ) || 0;
  const estimatedCostUsd = (() => {
    if (result?.estimatedCostUsd != null && Number.isFinite(Number(result.estimatedCostUsd))) {
      return Number(result.estimatedCostUsd);
    }
    if (result?.usage?.estimatedCostUsd != null && Number.isFinite(Number(result.usage.estimatedCostUsd))) {
      return Number(result.usage.estimatedCostUsd);
    }
    if (previous.estimatedCostUsd != null && Number.isFinite(previous.estimatedCostUsd)) {
      return previous.estimatedCostUsd;
    }
    return null;
  })();
  return {
    steps: (Number(previous.steps) || 0) + steps,
    toolCalls: (Number(previous.toolCalls) || 0) + toolCalls,
    estimatedCostUsd,
    wallTimeMs: Number(previous.wallTimeMs) || 0,
  };
}

function terminal(status, stopReason, details = {}) {
  const code =
    details.code ||
    (typeof stopReason === "object" ? stopReason?.code : stopReason) ||
    status;
  const outcome = {
    ok: status === TERMINAL.SUCCEEDED,
    status,
    reason: stopReason,
    code,
    ...details,
  };
  recordOutcome(outcome);
  return outcome;
}

class ClosedLoopExecutor {
  constructor(options = {}) {
    if (typeof options.execute !== "function") {
      throw new TypeError("ClosedLoopExecutor requires execute(ctx)");
    }
    if (typeof options.verify !== "function") {
      throw new TypeError("ClosedLoopExecutor requires verify(ctx, result)");
    }
    this.execute = options.execute;
    this.verify = options.verify;
    this.classifyFailure =
      typeof options.classifyFailure === "function"
        ? options.classifyFailure
        : defaultClassifyFailure;
    this.replan =
      typeof options.replan === "function"
        ? options.replan
        : async () => ({ status: OUTCOMES.BLOCKED, reason: STOP_REASONS.REPLAN_BLOCKED });
    this.checkpoint =
      typeof options.checkpoint === "function" ? options.checkpoint : async () => {};
    this.review =
      typeof options.review === "function"
        ? options.review
        : async (_ctx, payload) => payload;
    this.decisionTrace = options.decisionTrace || null;
    this.permissionCheck =
      typeof options.permissionCheck === "function"
        ? options.permissionCheck
        : async () => true;
    this.now =
      typeof options.now === "function"
        ? options.now
        : typeof options.clock === "function"
          ? options.clock
          : () => Date.now();
    this.budget = normalizeBudget(options.budget || {});
  }

  async _trace(moguTaskId, method, payload, options = {}) {
    if (!this.decisionTrace || !moguTaskId || typeof this.decisionTrace[method] !== "function") {
      return null;
    }
    return this.decisionTrace[method](moguTaskId, payload, options);
  }

  _budgetExhaustion(usage, startedAt, repairIterations) {
    const { budget } = this;
    const wallTimeMs = Math.max(0, this.now() - startedAt);
    usage.wallTimeMs = wallTimeMs;

    if (budget.maxWallTimeMs != null && wallTimeMs >= budget.maxWallTimeMs) {
      return {
        code: STOP_REASONS.BUDGET_WALL_TIME,
        reason: reason(REASONS.BUDGET_EXHAUSTED, "Wall-time budget exhausted", {
          maxWallTimeMs: budget.maxWallTimeMs,
          wallTimeMs,
        }),
      };
    }
    if (budget.maxSteps != null && usage.steps > budget.maxSteps) {
      return {
        code: STOP_REASONS.BUDGET_STEPS,
        reason: reason(REASONS.BUDGET_EXHAUSTED, "Step budget exhausted", {
          maxSteps: budget.maxSteps,
          steps: usage.steps,
        }),
      };
    }
    if (budget.maxToolCalls != null && usage.toolCalls > budget.maxToolCalls) {
      return {
        code: STOP_REASONS.BUDGET_TOOL_CALLS,
        reason: reason(REASONS.BUDGET_EXHAUSTED, "Tool-call budget exhausted", {
          maxToolCalls: budget.maxToolCalls,
          toolCalls: usage.toolCalls,
        }),
      };
    }
    if (budget.maxCostUsd != null) {
      if (usage.estimatedCostUsd == null || !Number.isFinite(usage.estimatedCostUsd)) {
        return {
          code: STOP_REASONS.COST_UNKNOWN,
          reason: reason(REASONS.UNKNOWN_PRICE, "Unknown cost cannot satisfy a cost-denominated budget", {
            maxCostUsd: budget.maxCostUsd,
          }),
        };
      }
      if (usage.estimatedCostUsd > budget.maxCostUsd) {
        return {
          code: STOP_REASONS.BUDGET_COST,
          reason: reason(REASONS.BUDGET_EXHAUSTED, "Cost budget exhausted", {
            maxCostUsd: budget.maxCostUsd,
            estimatedCostUsd: usage.estimatedCostUsd,
          }),
        };
      }
    }
    if (
      budget.maxRepairIterations != null &&
      repairIterations > budget.maxRepairIterations
    ) {
      return {
        code: STOP_REASONS.BUDGET_REPAIR_EXHAUSTED,
        reason: reason(REASONS.BUDGET_EXHAUSTED, "Repair iteration budget exhausted", {
          maxRepairIterations: budget.maxRepairIterations,
          repairIterations,
        }),
      };
    }
    return null;
  }

  async run(context = {}) {
    const ctx = { ...context, plan: context.plan || null, loop: context.loop || {} };
    const moguTaskId = ctx.moguTaskId || null;
    const startedAt = this.now();
    let usage = {
      steps: Number(ctx.usage?.steps) || 0,
      toolCalls: Number(ctx.usage?.toolCalls) || 0,
      estimatedCostUsd:
        ctx.estimatedCostUsd != null && Number.isFinite(Number(ctx.estimatedCostUsd))
          ? Number(ctx.estimatedCostUsd)
          : ctx.usage?.estimatedCostUsd != null && Number.isFinite(Number(ctx.usage.estimatedCostUsd))
            ? Number(ctx.usage.estimatedCostUsd)
            : null,
      wallTimeMs: 0,
    };
    let repairIterations = 0;
    let attempts = 0;
    let lastResult = null;
    let lastVerify = null;
    let lastFailure = null;
    let lastPlanUpdate = null;
    const rounds = [];

    const finish = (status, stopReason, extra = {}) =>
      terminal(status, stopReason, {
        moguTaskId,
        result: lastResult,
        verify: lastVerify,
        failure: lastFailure,
        planUpdate: lastPlanUpdate,
        attempts,
        repairIterations,
        usage: { ...usage, wallTimeMs: Math.max(0, this.now() - startedAt) },
        rounds,
        ...extra,
      });

    if (isGatewayAccepted(ctx)) {
      await this._trace(
        moguTaskId,
        "branch",
        { branch: "blocked", reason: STOP_REASONS.GATEWAY_ACCEPTED_NO_RESUBMIT },
        { dedupeKey: "closed-loop:gateway" }
      );
      return finish(TERMINAL.BLOCKED, STOP_REASONS.GATEWAY_ACCEPTED_NO_RESUBMIT, {
        code: STOP_REASONS.GATEWAY_ACCEPTED_NO_RESUBMIT,
      });
    }

    const permission = await this.permissionCheck(ctx);
    if (!permissionAllowed(permission)) {
      await this._trace(
        moguTaskId,
        "branch",
        {
          branch: "blocked",
          reason: STOP_REASONS.PERMISSION_DENIED,
          detail: permission?.reason || null,
        },
        { dedupeKey: "closed-loop:permission" }
      );
      return finish(TERMINAL.BLOCKED, STOP_REASONS.PERMISSION_DENIED, {
        code: STOP_REASONS.PERMISSION_DENIED,
        permission,
      });
    }

    // Cost-denominated budgets cannot be satisfied by unknown cost (same as router).
    if (this.budget.maxCostUsd != null && (usage.estimatedCostUsd == null || !Number.isFinite(usage.estimatedCostUsd))) {
      // Allow execute to supply cost later only when context explicitly opts in;
      // default fail-closed unless costKnownDefer is set.
      if (ctx.costKnownDefer !== true) {
        await this._trace(
          moguTaskId,
          "branch",
          { branch: "blocked", reason: STOP_REASONS.COST_UNKNOWN },
          { dedupeKey: "closed-loop:cost-unknown" }
        );
        return finish(TERMINAL.BLOCKED, STOP_REASONS.COST_UNKNOWN, {
          code: STOP_REASONS.COST_UNKNOWN,
          reason: reason(REASONS.UNKNOWN_PRICE, "Unknown cost cannot satisfy a cost-denominated budget", {
            maxCostUsd: this.budget.maxCostUsd,
          }),
        });
      }
    }

    // Bounded loop: first attempt + up to maxRepairIterations repairs.
    const maxRepairs =
      this.budget.maxRepairIterations == null
        ? 0
        : Math.max(0, Math.floor(this.budget.maxRepairIterations));

    while (true) {
      const preBudget = this._budgetExhaustion(usage, startedAt, repairIterations);
      if (preBudget) {
        await this._trace(
          moguTaskId,
          "branch",
          { branch: "blocked", reason: preBudget.code },
          { dedupeKey: `closed-loop:budget:${attempts}` }
        );
        return finish(TERMINAL.EXHAUSTED, preBudget.reason, { code: preBudget.code });
      }

      ctx.attempt = attempts;
      ctx.repairIterations = repairIterations;
      ctx.usage = usage;

      await this.checkpoint(ctx);
      await this._trace(
        moguTaskId,
        "branch",
        {
          branch: attempts === 0 ? "execute" : "repair_retry",
          attempt: attempts,
          repairIterations,
        },
        { dedupeKey: `closed-loop:checkpoint:${attempts}` }
      );

      lastResult = await this.execute(ctx);
      attempts += 1;
      usage = usageFromResult(lastResult, { ...usage, wallTimeMs: usage.wallTimeMs });

      if (lastResult?.permissionDenied === true || lastResult?.code === "permission_denied") {
        await this._trace(
          moguTaskId,
          "branch",
          { branch: "blocked", reason: STOP_REASONS.PERMISSION_DENIED },
          { dedupeKey: `closed-loop:exec-permission:${attempts}` }
        );
        return finish(TERMINAL.BLOCKED, STOP_REASONS.PERMISSION_DENIED, {
          code: STOP_REASONS.PERMISSION_DENIED,
        });
      }

      const postExecBudget = this._budgetExhaustion(usage, startedAt, repairIterations);
      if (postExecBudget && postExecBudget.code !== STOP_REASONS.BUDGET_REPAIR_EXHAUSTED) {
        await this._trace(
          moguTaskId,
          "branch",
          { branch: "blocked", reason: postExecBudget.code },
          { dedupeKey: `closed-loop:post-exec-budget:${attempts}` }
        );
        return finish(TERMINAL.EXHAUSTED, postExecBudget.reason, { code: postExecBudget.code });
      }

      lastVerify = await this.verify(ctx, lastResult);
      const verifyOk = lastVerify?.ok === true;
      await this._trace(
        moguTaskId,
        "verificationResult",
        {
          ok: verifyOk,
          stages: lastVerify?.stages || null,
          kind: lastVerify?.kind || null,
          attempt: attempts,
        },
        { dedupeKey: `closed-loop:verify:${attempts}` }
      );

      rounds.push({
        attempt: attempts,
        repairIterations,
        ok: lastResult?.ok !== false,
        verifyOk,
      });

      if (lastVerify?.permissionDenied === true || lastVerify?.code === "permission_denied") {
        await this._trace(
          moguTaskId,
          "branch",
          { branch: "blocked", reason: STOP_REASONS.PERMISSION_DENIED },
          { dedupeKey: `closed-loop:verify-permission:${attempts}` }
        );
        return finish(TERMINAL.BLOCKED, STOP_REASONS.PERMISSION_DENIED, {
          code: STOP_REASONS.PERMISSION_DENIED,
        });
      }

      if (verifyOk) {
        await this._trace(
          moguTaskId,
          "branch",
          { branch: "review", attempt: attempts },
          { dedupeKey: `closed-loop:review:${attempts}` }
        );
        const reviewed = await this.review(ctx, {
          result: lastResult,
          verify: lastVerify,
          attempts,
          repairIterations,
          usage,
        });
        await this._trace(
          moguTaskId,
          "branch",
          { branch: "succeeded", attempt: attempts },
          { dedupeKey: `closed-loop:succeeded:${attempts}` }
        );
        return finish(TERMINAL.SUCCEEDED, STOP_REASONS.VERIFIED, {
          code: STOP_REASONS.VERIFIED,
          review: reviewed,
        });
      }

      lastFailure = this.classifyFailure(lastVerify);
      if (lastFailure?.permissionDenied === true) {
        return finish(TERMINAL.BLOCKED, STOP_REASONS.PERMISSION_DENIED, {
          code: STOP_REASONS.PERMISSION_DENIED,
        });
      }

      if (repairIterations >= maxRepairs) {
        await this._trace(
          moguTaskId,
          "branch",
          {
            branch: "blocked",
            reason: STOP_REASONS.BUDGET_REPAIR_EXHAUSTED,
            repairIterations,
            maxRepairIterations: maxRepairs,
            failureKind: lastFailure?.kind || lastFailure?.class || null,
          },
          { dedupeKey: `closed-loop:repair-exhausted:${attempts}` }
        );
        return finish(
          TERMINAL.EXHAUSTED,
          reason(REASONS.BUDGET_EXHAUSTED, "Repair iteration budget exhausted", {
            maxRepairIterations: maxRepairs,
            repairIterations,
          }),
          { code: STOP_REASONS.BUDGET_REPAIR_EXHAUSTED }
        );
      }

      await this._trace(
        moguTaskId,
        "branch",
        {
          branch: "replan",
          attempt: attempts,
          repairIterations,
          failureKind: lastFailure?.kind || lastFailure?.class || null,
        },
        { dedupeKey: `closed-loop:replan:${attempts}` }
      );

      lastPlanUpdate = await this.replan(ctx, lastFailure);
      if (
        lastPlanUpdate == null ||
        lastPlanUpdate === OUTCOMES.BLOCKED ||
        lastPlanUpdate?.status === OUTCOMES.BLOCKED ||
        lastPlanUpdate?.blocked === true
      ) {
        await this._trace(
          moguTaskId,
          "branch",
          { branch: "blocked", reason: STOP_REASONS.REPLAN_BLOCKED },
          { dedupeKey: `closed-loop:replan-blocked:${attempts}` }
        );
        return finish(TERMINAL.BLOCKED, STOP_REASONS.REPLAN_BLOCKED, {
          code: STOP_REASONS.REPLAN_BLOCKED,
        });
      }

      if (lastPlanUpdate?.plan != null) ctx.plan = lastPlanUpdate.plan;
      if (lastPlanUpdate?.context && typeof lastPlanUpdate.context === "object") {
        Object.assign(ctx, lastPlanUpdate.context);
      }
      await this._trace(
        moguTaskId,
        "plan",
        {
          repairIterations: repairIterations + 1,
          failureKind: lastFailure?.kind || lastFailure?.class || null,
          planKeys: lastPlanUpdate && typeof lastPlanUpdate === "object" ? Object.keys(lastPlanUpdate) : [],
        },
        { dedupeKey: `closed-loop:plan:${attempts}` }
      );

      repairIterations += 1;
    }
  }
}

module.exports = {
  ClosedLoopExecutor,
  TERMINAL,
  STOP_REASONS,
  closedLoopEnabled,
  getClosedLoopStatus,
  resetClosedLoopStatusForTests,
  isGatewayAccepted,
  defaultClassifyFailure,
  normalizeBudget,
};

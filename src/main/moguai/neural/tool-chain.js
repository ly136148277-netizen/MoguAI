const PHASES = Object.freeze([
  "classify",
  "investigate",
  "plan",
  "execute",
  "verify",
  "review",
  "complete",
  "blocked",
]);

const CODING_TOOLS = Object.freeze({
  classify: [],
  investigate: [
    "grep",
    "search",
    "read",
    "list",
    "find_references",
    "repo_intelligence",
    "discover_tests",
  ],
  plan: [
    "set_plan",
    "record_failure_consumption",
    "record_patch_binding",
    "grep",
    "search",
    "read",
    "list",
    "repo_intelligence",
    "discover_tests",
  ],
  execute: ["apply_patch", "checkpoint", "rollback", "grep", "search", "read", "list"],
  verify: ["run_tests", "read", "grep", "search", "rollback", "checkpoint"],
  review: ["git_diff", "read", "grep", "search", "run_tests", "rollback", "set_plan", "checkpoint"],
  complete: [],
  blocked: [],
});

const BRAIN_TOOLS = Object.freeze({
  classify: [],
  investigate: ["mogu_search", "mogu_browser", "mogu_memory", "mogu_ollama"],
  plan: ["mogu_coding", "mogu_studio", "mogu_comfy", "mogu_media", "mogu_pc", "mogu_memory"],
  execute: ["*"],
  verify: ["mogu_coding", "mogu_pc", "mogu_browser", "mogu_ollama", "mogu_comfy", "mogu_studio"],
  review: ["mogu_coding", "mogu_memory", "mogu_browser", "mogu_search"],
  complete: [],
  blocked: [],
});

const TRANSITIONS = Object.freeze({
  classify: ["investigate", "plan", "blocked"],
  investigate: ["plan", "execute", "blocked"],
  plan: ["execute", "investigate", "blocked"],
  execute: ["verify", "review", "plan", "blocked"],
  verify: ["review", "plan", "execute", "blocked"],
  review: ["complete", "plan", "execute", "verify", "blocked"],
  complete: [],
  blocked: [],
});

const TOOL_PHASE_HINT = Object.freeze({
  set_plan: "plan",
  record_failure_consumption: "plan",
  record_patch_binding: "plan",
  apply_patch: "execute",
  checkpoint: "execute",
  rollback: "execute",
  run_tests: "verify",
  git_diff: "review",
});

function violation(code, message, details = {}) {
  return Object.freeze({
    ok: false,
    status: "BLOCKED",
    type: "TOOL_CHAIN_VIOLATION",
    code,
    reason: Object.freeze({ code, message, ...details }),
  });
}

function toolName(definition) {
  return String(definition?.function?.name || definition?.name || "").trim();
}

class ToolChain {
  constructor(options = {}) {
    this.kind = options.kind === "brain" ? "brain" : "coding";
    this.phase = PHASES.includes(options.phase) ? options.phase : "classify";
    this.maxCalls = Math.max(1, Number(options.maxCalls) || 32);
    this.maxSteps = Math.max(1, Number(options.maxSteps) || 24);
    this.maxRecoveries = Math.max(0, Number(options.maxRecoveries) || 2);
    this.calls = 0;
    this.steps = 0;
    this.recoveries = 0;
    this.history = [];
    this.knownTools = new Set(
      (Array.isArray(options.tools) ? options.tools : []).map(toolName).filter(Boolean)
    );
    this.allowlists = options.allowlists || (this.kind === "brain" ? BRAIN_TOOLS : CODING_TOOLS);
  }

  allowed(phase = this.phase) {
    return [...(this.allowlists[phase] || [])];
  }

  isAllowed(name, phase = this.phase) {
    const allowed = this.allowlists[phase] || [];
    return allowed.includes("*") || allowed.includes(String(name));
  }

  transition(next, evidence = {}) {
    const target = String(next || "");
    if (!PHASES.includes(target)) {
      return violation("PHASE_INVALID", `Unknown tool-chain phase: ${target}`, {
        phase: this.phase,
        requestedPhase: target,
      });
    }
    if (!(TRANSITIONS[this.phase] || []).includes(target)) {
      return violation("TRANSITION_INVALID", `Cannot transition ${this.phase} → ${target}`, {
        phase: this.phase,
        requestedPhase: target,
      });
    }
    if (target === "execute" && this.kind === "coding" && evidence.planReady !== true) {
      return violation("PLAN_REQUIRED", "Coding execution requires a recorded plan", {
        phase: this.phase,
      });
    }
    if (target === "complete" && evidence.reviewed !== true) {
      return violation("REVIEW_REQUIRED", "Completion requires review evidence", {
        phase: this.phase,
      });
    }
    const previous = this.phase;
    this.phase = target;
    this.history.push({ type: "transition", from: previous, to: target });
    return { ok: true, status: "OK", phase: target };
  }

  recover(target = "plan", evidence = {}) {
    if (this.recoveries >= this.maxRecoveries) {
      this.phase = "blocked";
      return violation("RECOVERY_LIMIT", "Tool-chain recovery limit exceeded", {
        recoveries: this.recoveries,
        maxRecoveries: this.maxRecoveries,
      });
    }
    this.recoveries += 1;
    return this.transition(target, evidence);
  }

  beginStep() {
    if (this.steps >= this.maxSteps) {
      this.phase = "blocked";
      return violation("MAX_STEPS_EXCEEDED", "Tool-chain step limit exceeded", {
        steps: this.steps,
        maxSteps: this.maxSteps,
      });
    }
    this.steps += 1;
    return { ok: true, status: "OK", phase: this.phase, steps: this.steps };
  }

  validateCall(call, evidence = {}) {
    const name = typeof call === "string" ? call : toolName(call?.function ? call : call?.function || call);
    if (!name) return violation("TOOL_NAME_MISSING", "Tool call has no name", { phase: this.phase });
    if (this.knownTools.size && !this.knownTools.has(name)) {
      return violation("TOOL_NOT_ADVERTISED", `Model requested an unadvertised tool: ${name}`, {
        phase: this.phase,
        tool: name,
      });
    }
    if (this.calls >= this.maxCalls) {
      this.phase = "blocked";
      return violation("MAX_CALLS_EXCEEDED", "Tool-chain call limit exceeded", {
        phase: this.phase,
        tool: name,
        calls: this.calls,
        maxCalls: this.maxCalls,
      });
    }
    if (!this.isAllowed(name)) {
      return violation("TOOL_NOT_ALLOWED_IN_PHASE", `${name} is not allowed during ${this.phase}`, {
        phase: this.phase,
        tool: name,
        allowedTools: this.allowed(),
      });
    }
    this.calls += 1;
    this.history.push({ type: "tool", phase: this.phase, tool: name });
    return { ok: true, status: "OK", phase: this.phase, tool: name, calls: this.calls };
  }

  filterTools(definitions, phase = this.phase) {
    const list = Array.isArray(definitions) ? definitions : [];
    // Never expand the advertised set from model-supplied extras; only remove.
    return list.filter((definition) => {
      const name = toolName(definition);
      if (!name) return false;
      if (this.knownTools.size && !this.knownTools.has(name)) return false;
      return this.isAllowed(name, phase);
    });
  }

  phaseForTool(name) {
    if (this.kind === "coding") {
      return TOOL_PHASE_HINT[name] || ([
        "grep",
        "search",
        "read",
        "list",
        "find_references",
        "repo_intelligence",
        "discover_tests",
      ].includes(name)
        ? "investigate"
        : this.phase);
    }
    if (this.phase === "classify") return "investigate";
    if (this.phase === "investigate" && !this.isAllowed(name, "investigate")) return "plan";
    if (this.phase === "plan") return "execute";
    return this.phase;
  }

  prepareCall(call, evidence = {}) {
    const name = typeof call === "string" ? call : toolName(call?.function ? call : call?.function || call);
    const target = this.phaseForTool(name);
    if (target !== this.phase) {
      let cursor = this.phase;
      while (cursor !== target) {
        const next =
          cursor === "classify" ? "investigate" :
          cursor === "investigate" && target !== "plan" ? "plan" :
          cursor === "plan" && target !== "execute" ? "execute" :
          target;
        const moved = this.transition(next, evidence);
        if (!moved.ok) return moved;
        cursor = this.phase;
      }
    }
    return this.validateCall(name, evidence);
  }

  snapshot() {
    return Object.freeze({
      kind: this.kind,
      phase: this.phase,
      calls: this.calls,
      maxCalls: this.maxCalls,
      steps: this.steps,
      maxSteps: this.maxSteps,
      recoveries: this.recoveries,
      maxRecoveries: this.maxRecoveries,
    });
  }
}

function createToolChain(options) {
  return new ToolChain(options);
}

module.exports = {
  PHASES,
  TRANSITIONS,
  CODING_TOOLS,
  BRAIN_TOOLS,
  ToolChain,
  createToolChain,
  violation,
  toolName,
};

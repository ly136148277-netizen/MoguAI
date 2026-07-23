/**
 * Explicit Agent executor routing (renderer + Node tests).
 * Principle: use the selected executor only; never silent-fallback unless opted in.
 */

function normalizeChannel(channel) {
  const c = String(channel || "")
    .trim()
    .toLowerCase();
  if (c === "api" || c === "local" || c === "builtin") return c;
  if (!c) return "unset";
  return c;
}

function normalizeRuntime(mode) {
  const m = String(mode || "")
    .trim()
    .toLowerCase();
  if (m === "openclaw" || m === "pai") return m;
  if (!m) return "unset";
  return m;
}

/**
 * Decide how the Agent panel should handle a user turn.
 *
 * @param {object} opts
 * @param {string} [opts.brainChannel] builtin | api | local | unset
 * @param {boolean} [opts.brainReady]
 * @param {string} [opts.brainReason]
 * @param {string} [opts.runtimeMode] openclaw | pai | unset
 * @param {boolean} [opts.openclawAvailable] false when known-down; omit/true = try
 * @param {boolean} [opts.paiAvailable]
 * @param {boolean} [opts.allowAutoFallback] only when user enabled (e.g. openclawFallbackToPai)
 * @param {boolean} [opts.isHelpQuestion]
 * @returns {{
 *   action: "use"|"tutorial"|"need_setup"|"first_run"|"unavailable",
 *   executor?: "brain"|"openclaw"|"pai"|null,
 *   message?: string,
 *   choices?: string[],
 *   via?: string
 * }}
 */
function decideAgentRoute(opts = {}) {
  const channel = normalizeChannel(opts.brainChannel);
  const runtime = normalizeRuntime(opts.runtimeMode);
  const brainReady = opts.brainReady === true;
  const allowAutoFallback = opts.allowAutoFallback === true;
  const isHelp = opts.isHelpQuestion === true;
  const brainReason = String(opts.brainReason || "").trim();

  // Explicit Brain channel: only Brain when ready; never silently jump to OpenClaw/PAI.
  if (channel === "api" || channel === "local") {
    if (brainReady) {
      return { action: "use", executor: "brain" };
    }
    if (isHelp) {
      return { action: "tutorial", executor: null };
    }
    return {
      action: "need_setup",
      executor: "brain",
      message: brainReason || "请先完成大脑配置后再发送。",
      choices: ["configure_brain", "switch_openclaw", "switch_pai"],
    };
  }

  // Builtin / unset brain: help stays on tutorial; do NOT block OpenClaw/PAI.
  if (isHelp) {
    return { action: "tutorial", executor: null };
  }

  if (runtime === "openclaw") {
    if (opts.openclawAvailable === false) {
      if (allowAutoFallback && opts.paiAvailable !== false) {
        return { action: "use", executor: "pai", via: "auto_fallback" };
      }
      return {
        action: "unavailable",
        executor: "openclaw",
        message:
          "已选择 OpenClaw，但当前不可用。请连接 Gateway，或改选 PAI / 配置大脑——不会静默切换。",
        choices: ["retry_openclaw", "switch_pai", "configure_brain"],
      };
    }
    return { action: "use", executor: "openclaw" };
  }

  if (runtime === "pai") {
    if (opts.paiAvailable === false) {
      return {
        action: "unavailable",
        executor: "pai",
        message: "已选择 PAI，但当前不可用。请到「环境」检查，或改选 OpenClaw / 配置大脑。",
        choices: ["switch_openclaw", "configure_brain"],
      };
    }
    return { action: "use", executor: "pai" };
  }

  // No runtime chosen yet (first-run / public clean profile).
  return {
    action: "first_run",
    executor: null,
    message: "请先选择执行方：配置大脑（联网 API / 本机模型）、OpenClaw，或 PAI。",
    choices: ["configure_brain", "switch_openclaw", "switch_pai"],
  };
}

/**
 * Pill label for the current turn (UI only — does not imply availability).
 */
function resolveExecutorLabel({ brainChannel, brainReady, runtimeMode } = {}) {
  const channel = normalizeChannel(brainChannel);
  if ((channel === "api" || channel === "local") && brainReady === true) {
    return "brain";
  }
  const runtime = normalizeRuntime(runtimeMode);
  if (runtime === "openclaw") return "openclaw";
  if (runtime === "pai") return "pai";
  return null;
}

/**
 * Whether the orange “configure brain” banner should block attention.
 * Builtin + OpenClaw/PAI is a valid public default — do not nag as if Brain were required.
 */
function shouldShowBrainSetupBanner({ brainChannel, brainReady, runtimeMode } = {}) {
  if (brainReady === true) return false;
  const channel = normalizeChannel(brainChannel);
  if (channel === "api" || channel === "local") return true;
  // builtin/unset: only show if runtime also unset (first-run)
  return normalizeRuntime(runtimeMode) === "unset";
}

const api = {
  normalizeChannel,
  normalizeRuntime,
  decideAgentRoute,
  resolveExecutorLabel,
  shouldShowBrainSetupBanner,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

if (typeof window !== "undefined") {
  window.AgentRouting = api;
}

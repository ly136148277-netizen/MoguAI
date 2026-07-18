/**
 * PAI fallback for OpenClaw Bridge.
 *
 * Iron rule: if a request was already accepted by Gateway, a wait-timeout
 * MUST NOT auto-resubmit via PAI (would double-execute).
 */

const FALLBACK_BLOCKED_AFTER_ACCEPTED = "gateway_accepted_no_auto_fallback";

/**
 * @param {{
 *   bridgeState: string,
 *   openclawEnabled: boolean,
 *   fallbackToPai: boolean,
 *   requestAcceptedByGateway: boolean,
 *   waitTimedOut?: boolean,
 * }} ctx
 */
function decideFallback(ctx = {}) {
  const fallbackToPai = ctx.fallbackToPai !== false;
  const openclawEnabled = ctx.openclawEnabled === true;
  const state = String(ctx.bridgeState || "disconnected");
  const accepted = ctx.requestAcceptedByGateway === true;
  const waitTimedOut = ctx.waitTimedOut === true;

  if (accepted && waitTimedOut) {
    return {
      usePai: false,
      reason: FALLBACK_BLOCKED_AFTER_ACCEPTED,
      message:
        "请求已被 OpenClaw Gateway 接受；等待超时不会自动降级到 PAI，避免重复执行。请查询任务状态或精确取消。",
    };
  }

  if (!openclawEnabled) {
    return { usePai: true, reason: "openclaw_disabled", message: "OpenClaw 未启用，使用 PAI。" };
  }

  if (!fallbackToPai) {
    return {
      usePai: false,
      reason: "fallback_disabled",
      message: "已关闭降级到 PAI；请检查 OpenClaw Gateway。",
    };
  }

  if (["ready"].includes(state)) {
    return { usePai: false, reason: "bridge_ready", message: "Bridge 就绪，使用 OpenClaw。" };
  }

  if (["connecting", "authenticating"].includes(state)) {
    return {
      usePai: false,
      reason: "bridge_busy",
      message: "正在连接 OpenClaw，请稍候。",
    };
  }

  return {
    usePai: true,
    reason: `bridge_${state}`,
    message: `OpenClaw 不可用（${state}），降级到 PAI。`,
  };
}

module.exports = {
  decideFallback,
  FALLBACK_BLOCKED_AFTER_ACCEPTED,
};

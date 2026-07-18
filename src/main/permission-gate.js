const { detectRequiredLevel, describeRisk, buildConfirmedCommand } = require("../shared/butler-risk");

/**
 * Gate a user/agent command through PermissionProxy using fixed L1/L2/L3 rules.
 */
async function gateCommand(permissionProxy, command, options = {}) {
  if (!permissionProxy) {
    return {
      ok: false,
      allowed: false,
      reason: "no_proxy",
      message: "权限代理未初始化，已拒绝执行。",
      riskLevel: 3,
    };
  }
  const text = String(command || "").trim();
  const riskLevel = options.riskLevel != null ? Number(options.riskLevel) : detectRequiredLevel(text);
  const risk = describeRisk(riskLevel, text);
  const decision = await permissionProxy.requestPermission({
    tool: options.tool || "pai.command",
    action: text.slice(0, 500),
    riskLevel,
    sessionKey: options.sessionKey || null,
    runId: options.runId || null,
    channel: options.channel || "desktop",
    argsDigest: options.argsDigest || null,
    requireGatewayApproval: options.requireGatewayApproval === true,
    gatewayApproved: options.gatewayApproved === true,
  });
  return {
    ...decision,
    risk,
    requiredLevel: riskLevel,
    confirmedCommand: riskLevel >= 2 ? buildConfirmedCommand(text) : text,
  };
}

module.exports = {
  gateCommand,
  detectRequiredLevel,
  describeRisk,
  buildConfirmedCommand,
};

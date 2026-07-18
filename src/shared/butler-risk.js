/**
 * Risk assessment for PAI butler commands (renderer + Node tests).
 */

const L3_PATTERNS = [
  /^删除/i,
  /^删掉/i,
  /删除文件/i,
  /删除文件夹/i,
  /批量/i,
  /\bbatch\b/i,
  /移除文件/i,
];

const L2_PATTERNS = [
  /^备份/i,
  /^恢复/i,
  /^下载/i,
  /^更新/i,
  /确认出片/i,
  /^出片/i,
  /确认千问/i,
  /确认zimage/i,
  /确认ltx/i,
  /确认ace/i,
  /确认单镜头/i,
  /确认创作台/i,
  /更新\s*comfyui/i,
  /winget/i,
  /检查软件更新/i,
];

const WORKFLOW_CONFIRM_PATTERNS = [
  /^确认出片/i,
  /^确认千问/i,
  /^确认zimage/i,
  /^确认ltx/i,
  /^确认ace/i,
  /^确认单镜头/i,
  /^确认创作台/i,
  /^出片\s/i,
];

function detectRequiredLevel(command) {
  const text = String(command || "").trim();
  if (!text) {
    return 1;
  }
  if (L3_PATTERNS.some((pattern) => pattern.test(text))) {
    return 3;
  }
  if (L2_PATTERNS.some((pattern) => pattern.test(text))) {
    return 2;
  }
  return 1;
}

function hasConfirmPrefix(command) {
  return /^确认/.test(String(command || "").trim());
}

function isWorkflowRun(command) {
  const text = String(command || "").trim();
  return WORKFLOW_CONFIRM_PATTERNS.some((pattern) => pattern.test(text));
}

function buildConfirmedCommand(command) {
  const text = String(command || "").trim();
  if (!text) {
    return text;
  }
  if (hasConfirmPrefix(text)) {
    return text;
  }
  if (/^出片\s/.test(text)) {
    return text.replace(/^出片\s*/, "确认出片 ");
  }
  return `确认${text}`;
}

function describeRisk(requiredLevel, command) {
  if (requiredLevel >= 3) {
    return {
      title: "L3 危险操作确认",
      message: "此指令可能删除或批量改动文件，执行前请再次确认。",
      detail: command,
      confirmLabel: "确认执行（L3）",
      severity: "high",
    };
  }
  if (isWorkflowRun(command)) {
    return {
      title: "ComfyUI 出片确认",
      message: "出片会占用 GPU 并可能耗时数分钟至数十分钟，确认后开始排队。",
      detail: command,
      confirmLabel: "确认出片（L2）",
      severity: "medium",
    };
  }
  if (requiredLevel >= 2) {
    return {
      title: "L2 操作确认",
      message: "此指令会下载、备份、恢复或改动 ComfyUI/项目文件，确认后继续。",
      detail: command,
      confirmLabel: "确认执行（L2）",
      severity: "medium",
    };
  }
  return null;
}

function assess(command, sessionLevel) {
  const text = String(command || "").trim();
  const level = Number(sessionLevel) || 1;
  const requiredLevel = detectRequiredLevel(text);
  const confirmed = hasConfirmPrefix(text);

  let needsConfirm = false;
  let suggestedLevel = level;
  let reason = "";

  if (requiredLevel > level) {
    needsConfirm = true;
    suggestedLevel = requiredLevel;
    reason = `需要 L${requiredLevel}，当前为 L${level}`;
  } else if (requiredLevel >= 3) {
    needsConfirm = true;
    suggestedLevel = Math.max(level, 3);
    reason = "L3 删除/批量操作";
  } else if (requiredLevel >= 2 && !confirmed) {
    needsConfirm = true;
    suggestedLevel = Math.max(level, 2);
    reason = isWorkflowRun(text) ? "出片需明确确认" : "L2 写操作需确认";
  } else if (requiredLevel >= 2 && confirmed) {
    needsConfirm = true;
    suggestedLevel = Math.max(level, 2);
    reason = "二次确认";
  }

  const risk = describeRisk(requiredLevel, text);

  return {
    needsConfirm,
    requiredLevel,
    sessionLevel: level,
    suggestedLevel,
    reason,
    confirmedCommand: buildConfirmedCommand(text),
    risk,
  };
}

function assessPaiResponse(command, result) {
  if (!result?.needs_confirm) {
    return null;
  }
  const hint = result.hint ? `\n${result.hint}` : "";
  return {
    needsConfirm: true,
    requiredLevel: 2,
    sessionLevel: null,
    suggestedLevel: 2,
    reason: "PAI 要求确认",
    confirmedCommand: buildConfirmedCommand(command),
    risk: {
      title: "PAI 需要确认",
      message: String(result.error || "该操作需要确认后才能执行"),
      detail: `${command}${hint}`,
      confirmLabel: "确认执行",
      severity: "medium",
    },
  };
}

const butlerRiskApi = {
  assess,
  assessPaiResponse,
  buildConfirmedCommand,
  detectRequiredLevel,
  describeRisk,
  hasConfirmPrefix,
  isWorkflowRun,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = butlerRiskApi;
}

if (typeof window !== "undefined") {
  window.ButlerRisk = butlerRiskApi;
}

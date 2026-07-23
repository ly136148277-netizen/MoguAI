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

function humanizeSkillAction(command) {
  const text = String(command || "").trim();
  const skillMatch = text.match(/^(mogu\.[\w.]+)\.(\w+)\b/);
  if (!skillMatch) return null;
  const skillId = skillMatch[1];
  const op = skillMatch[2];
  const map = {
    "mogu.coding.commit": {
      title: "确认提交代码",
      message: "将把工作区改动写入 Git 提交。请确认说明无误；提交后可用 git 回滚。",
      next: "若只想查看改动，可先取消，在任务卡点「刷新改动」。",
    },
    "mogu.coding.run": {
      title: "确认运行 MOGU AI 编程",
      message: "MOGU AI 编程将在本地工作区改文件/跑命令（引擎 A 或 B）。",
      next: "完成后可在任务卡查看 diff，再决定是否提交。",
    },
    "mogu.coding.verify": {
      title: "确认跑测试",
      message: "将在工作区执行验证命令（默认 npm test），可能较久。",
      next: "失败时可换引擎重试或检查测试日志。",
    },
    "mogu.browser.act": {
      title: "确认浏览器自动化",
      message: "将用 Playwright 打开网页并执行点击/填表等步骤（本机外置引擎）。",
      next: "不会自动处理验证码或支付；失败可改用 open/fetch。",
    },
    "mogu.browser.click": {
      title: "确认网页点击",
      message: "将在页面上点击指定元素。",
      next: "选择器不对时可改用 fetch 只读正文。",
    },
    "mogu.browser.fill": {
      title: "确认网页填表",
      message: "将向页面输入框写入内容（不会替你提交支付/密码，除非步骤里包含）。",
      next: "敏感信息请勿让助手代填。",
    },
    "mogu.comfy.run": {
      title: "确认 ComfyUI 出片",
      message: "出片会占用 GPU，可能耗时数分钟至数十分钟。",
      next: "可在任务中心查看进度或精确取消。",
    },
    "mogu.studio.run": {
      title: "确认创作台出片",
      message: "创作台将提交出片任务到 ComfyUI。",
      next: "完成后可在创作台/任务中心查看输出。",
    },
    "mogu.pc.run": {
      title: "确认本机命令",
      message: "将通过 PAI 执行本机操作（打开应用、搜索、备份等）。",
      next: "高风险删除类操作会再要一次 L3 确认。",
    },
  };
  const key = `${skillId}.${op}`;
  if (map[key]) return { ...map[key], detail: text };
  return {
    title: `确认 ${skillId} · ${op}`,
    message: "此操作需要你的明确同意后才会执行。",
    next: "不确定时可取消，改用更轻量的只读操作（status / review / fetch）。",
    detail: text,
  };
}

function describeRisk(requiredLevel, command) {
  const human = humanizeSkillAction(command);
  if (requiredLevel >= 3) {
    return {
      title: human?.title || "L3 危险操作确认",
      message:
        human?.message ||
        "此操作可能删除或批量改动文件。未确认将不会执行。",
      detail: [human?.detail || command, human?.next ? `\n下一步建议：${human.next}` : ""]
        .filter(Boolean)
        .join(""),
      confirmLabel: "确认执行（危险）",
      severity: "high",
      nextHint: human?.next || "取消后可改用备份或只读查询。",
    };
  }
  if (isWorkflowRun(command) || /mogu\.(comfy|studio)\.run/.test(String(command))) {
    return {
      title: human?.title || "ComfyUI 出片确认",
      message: human?.message || "出片会占用 GPU 并可能耗时数分钟至数十分钟，确认后开始排队。",
      detail: [command, human?.next ? `\n下一步建议：${human.next}` : ""].filter(Boolean).join(""),
      confirmLabel: "确认出片",
      severity: "medium",
      nextHint: human?.next || "可在任务中心取消或查看日志。",
    };
  }
  if (requiredLevel >= 2) {
    return {
      title: human?.title || "需要你确认后继续",
      message:
        human?.message ||
        "此操作会改动文件、跑命令或调用外置引擎。确认后继续；取消则什么都不做。",
      detail: [human?.detail || command, human?.next ? `\n下一步建议：${human.next}` : ""]
        .filter(Boolean)
        .join(""),
      confirmLabel: "确认执行",
      severity: "medium",
      nextHint: human?.next || "可先用 status / review / fetch 只读查看。",
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

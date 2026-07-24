"use strict";

const CHANNELS = Object.freeze(["telegram", "qq", "wechat", "mock"]);
const CAPABILITIES = Object.freeze(["READ", "WRITE", "DELETE", "RUN", "SYSTEM"]);
const RESULT_KINDS = Object.freeze([
  "markdown",
  "image",
  "pdf",
  "zip",
  "patch",
  "diff",
  "commit",
  "pr",
  "file",
  "log",
  "status",
  "error",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value, max = 4_000) {
  if (value == null) return "";
  return String(value).slice(0, max);
}

function normalizeChannel(value) {
  const channel = String(value || "").trim().toLowerCase();
  return CHANNELS.includes(channel) ? channel : null;
}

function normalizeCapability(value) {
  const cap = String(value || "READ").trim().toUpperCase();
  return CAPABILITIES.includes(cap) ? cap : "READ";
}

function capabilityToRiskLevel(capability) {
  switch (normalizeCapability(capability)) {
    case "READ":
      return 1;
    case "WRITE":
    case "RUN":
      return 2;
    case "DELETE":
    case "SYSTEM":
      return 3;
    default:
      return 3;
  }
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @typedef {object} RemoteMessage
 * @property {string} channel
 * @property {string} userId
 * @property {string} [conversationId]
 * @property {string} [messageId]
 * @property {string} [text]
 * @property {string} [command]
 * @property {Array<object>} [attachments]
 * @property {object} [raw]
 */

/**
 * @typedef {object} TaskRequest
 * @property {string} requestId
 * @property {string} channel
 * @property {string} userId
 * @property {string} sessionId
 * @property {string} text
 * @property {string} capability
 * @property {string} [skillId]
 * @property {string} [op]
 * @property {object} [args]
 * @property {boolean} [requiresApproval]
 */

/**
 * @typedef {object} TaskResult
 * @property {string} moguTaskId
 * @property {string} status
 * @property {string} kind
 * @property {string} [markdown]
 * @property {Array<object>} [artifacts]
 * @property {string} [error]
 * @property {object} [progress]
 */

function createTaskRequest(input = {}) {
  const channel = normalizeChannel(input.channel) || "mock";
  const capability = normalizeCapability(input.capability || input.requiredCapability);
  return Object.freeze({
    requestId: boundedString(input.requestId || makeId("rreq"), 160),
    channel,
    userId: boundedString(input.userId || "anonymous", 200),
    conversationId: boundedString(input.conversationId || input.chatId || "", 200) || null,
    sessionId: boundedString(input.sessionId || "", 200) || null,
    text: boundedString(input.text || input.prompt || "", 12_000),
    command: boundedString(input.command || "", 80) || null,
    capability,
    skillId: boundedString(input.skillId || "mogu.memory", 80),
    op: boundedString(input.op || "recall", 80),
    args: isPlainObject(input.args) ? { ...input.args } : {},
    attachments: Array.isArray(input.attachments) ? input.attachments.slice(0, 20) : [],
    requiresApproval: input.requiresApproval !== false && capability !== "READ",
    createdAt: new Date().toISOString(),
  });
}

function createTaskResult(input = {}) {
  const kind = RESULT_KINDS.includes(String(input.kind || "").toLowerCase())
    ? String(input.kind).toLowerCase()
    : "markdown";
  return Object.freeze({
    moguTaskId: boundedString(input.moguTaskId || "", 160) || null,
    status: boundedString(input.status || "succeeded", 40),
    kind,
    markdown: boundedString(input.markdown || input.text || "", 20_000),
    artifacts: Array.isArray(input.artifacts) ? input.artifacts.slice(0, 50) : [],
    error: input.error ? boundedString(input.error, 4_000) : null,
    progress: isPlainObject(input.progress) ? { ...input.progress } : null,
    finishedAt: new Date().toISOString(),
  });
}

module.exports = {
  CHANNELS,
  CAPABILITIES,
  RESULT_KINDS,
  isPlainObject,
  boundedString,
  normalizeChannel,
  normalizeCapability,
  capabilityToRiskLevel,
  makeId,
  createTaskRequest,
  createTaskResult,
};

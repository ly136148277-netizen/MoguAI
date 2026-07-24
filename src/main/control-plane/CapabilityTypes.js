"use strict";

/** Public capability health states (user-facing; no ports/paths). */
const CAPABILITY_STATES = Object.freeze([
  "Installed",
  "Running",
  "Healthy",
  "Missing",
  "PermissionDenied",
  "NotConfigured",
  "Disabled",
]);

function normalizeState(value, fallback = "Missing") {
  const state = String(value || "").trim();
  return CAPABILITY_STATES.includes(state) ? state : fallback;
}

function publicLabel(state) {
  switch (normalizeState(state)) {
    case "Healthy":
    case "Running":
      return "就绪";
    case "Installed":
      return "已安装";
    case "NotConfigured":
      return "未配置";
    case "Disabled":
      return "已关闭";
    case "PermissionDenied":
      return "权限不足";
    case "Missing":
    default:
      return "未就绪";
  }
}

function isReadyState(state) {
  const s = normalizeState(state);
  return s === "Healthy" || s === "Running" || s === "Installed";
}

module.exports = {
  CAPABILITY_STATES,
  normalizeState,
  publicLabel,
  isReadyState,
};

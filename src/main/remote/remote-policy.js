"use strict";

function channelEnabledFlag(value) {
  if (value === true) return true;
  if (value && typeof value === "object" && !Array.isArray(value) && value.enabled === true) {
    return true;
  }
  return false;
}

function isRemoteChannelEnabled(remote = {}, channel) {
  if (!channel || channel === "mock") return true;
  return channelEnabledFlag(remote[channel]);
}

function normalizeChannelSetting(value) {
  return { enabled: channelEnabledFlag(value) };
}

function sanitizeRemoteSettings(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    enabled: source.enabled === true,
    telegram: normalizeChannelSetting(source.telegram),
    qq: normalizeChannelSetting(source.qq),
    wechat: normalizeChannelSetting(source.wechat),
    requireApproval: source.requireApproval !== false,
    allowAutoExecute: source.allowAutoExecute === true,
  };
}

function sanitizeRemoteOwner(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    telegramUserId: String(source.telegramUserId || "").trim(),
    qqUserId: String(source.qqUserId || "").trim(),
    wechatUserId: String(source.wechatUserId || "").trim(),
  };
}

/**
 * Fail-closed owner binding for production channels.
 * mock channel skips owner check (unit/acceptance harness).
 */
function assertRemoteOwner(settings, message = {}) {
  const channel = String(message.channel || "").toLowerCase();
  if (!channel || channel === "mock") {
    return { ok: true, reason: "mock" };
  }
  const owner = sanitizeRemoteOwner(settings?.remoteOwner);
  const key =
    channel === "telegram"
      ? "telegramUserId"
      : channel === "qq"
        ? "qqUserId"
        : channel === "wechat"
          ? "wechatUserId"
          : null;
  if (!key) return { ok: false, reason: "unsupported_channel" };
  const expected = owner[key];
  if (!expected) {
    return { ok: false, reason: "owner_not_configured" };
  }
  const actual = String(message.userId || "").trim();
  if (actual !== expected) {
    return { ok: false, reason: "owner_mismatch", expectedConfigured: true };
  }
  return { ok: true, reason: "owner_ok" };
}

const LEVEL1_COMMANDS = new Set([
  "/start",
  "/help",
  "/status",
  "/log",
  "/mogu",
  "/cancel",
]);

function isLevel1Command(command, text = "") {
  const cmd = String(command || "").toLowerCase();
  if (LEVEL1_COMMANDS.has(cmd)) return true;
  const body = String(text || "").trim().toLowerCase();
  if (body === "/mogu status" || body.startsWith("/mogu status")) return true;
  if (body === "status" || body === "/status") return true;
  return false;
}

module.exports = {
  channelEnabledFlag,
  isRemoteChannelEnabled,
  sanitizeRemoteSettings,
  sanitizeRemoteOwner,
  assertRemoteOwner,
  isLevel1Command,
  LEVEL1_COMMANDS,
};

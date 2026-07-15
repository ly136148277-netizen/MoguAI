/**
 * Windows 定时关机（shutdown /s /t）与取消（shutdown /a）。
 */
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const PRESETS = {};

let pending = null;

function getStatus() {
  if (!pending) {
    return { pending: false };
  }
  const remainMs = pending.at - Date.now();
  return {
    pending: remainMs > 0,
    preset: pending.preset,
    label: pending.label,
    at: pending.at,
    remainSeconds: Math.max(0, Math.ceil(remainMs / 1000)),
  };
}

function runShutdown(args) {
  return execFileAsync("shutdown.exe", args, {
    windowsHide: true,
    timeout: 15000,
  });
}

async function scheduleShutdown({ preset, seconds, label } = {}) {
  let secs = Number(seconds);
  let presetKey = preset || "custom";
  let text = label;

  if (preset && PRESETS[preset]) {
    secs = PRESETS[preset].seconds;
    presetKey = preset;
    text = PRESETS[preset].label;
  }

  if (!Number.isFinite(secs) || secs < 60) {
    throw new Error("关机倒计时至少 1 分钟");
  }
  if (secs > 24 * 60 * 60) {
    throw new Error("关机倒计时不能超过 24 小时");
  }

  // 先取消已有计划，再设新的
  try {
    await runShutdown(["/a"]);
  } catch {
    // 没有进行中的关机计划时会失败，忽略
  }

  const comment = `MOGU AI：${text || `${secs} 秒后关机`}`;
  await runShutdown(["/s", "/t", String(Math.floor(secs)), "/c", comment]);

  pending = {
    preset: presetKey,
    label: text || `${Math.floor(secs)} 秒后`,
    at: Date.now() + secs * 1000,
    seconds: Math.floor(secs),
  };

  return getStatus();
}

async function cancelShutdown() {
  try {
    await runShutdown(["/a"]);
  } catch (error) {
    const msg = String(error?.stderr || error?.message || "");
    // 1116 = 没有要中止的关机
    if (!/1116|没有|not/.test(msg) && error?.code) {
      // still clear local state
    }
  }
  pending = null;
  return { pending: false, cancelled: true };
}

module.exports = {
  PRESETS,
  getStatus,
  scheduleShutdown,
  cancelShutdown,
};

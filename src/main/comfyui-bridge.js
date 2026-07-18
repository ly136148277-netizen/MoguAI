const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

/**
 * ComfyUI merged targeted `/interrupt` with `prompt_id` in PR #9607 (≈ 0.3.56).
 * Below this version (or unknown version) we must not claim precise running-cancel.
 */
const MIN_TARGETED_INTERRUPT_VERSION = "0.3.56";

function parseVersionParts(version) {
  const text = String(version || "").trim().replace(/^v/i, "");
  if (!text) return null;
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function supportsTargetedInterrupt(version) {
  const cmp = compareSemver(version, MIN_TARGETED_INTERRUPT_VERSION);
  return cmp !== null && cmp >= 0;
}

function readConfiguredComfyUi(paiRoot) {
  const yamlPath = path.join(paiRoot, "config", "pai.yaml");
  if (!fs.pathExistsSync(yamlPath)) {
    return null;
  }
  const text = fs.readFileSync(yamlPath, "utf8");
  const section = text.split(/^comfyui:/m)[1]?.split(/^[^\s]/m)[0] || text;
  const sectionPath = section.match(/^\s*path:\s*"(.*?)"/m);
  const sectionApi = section.match(/^\s*api:\s*"(.*?)"/m);
  const enabledMatch = section.match(/^\s*enabled:\s*(true|false)/m);

  return {
    enabled: enabledMatch ? enabledMatch[1] === "true" : true,
    path: sectionPath?.[1] || null,
    api: sectionApi?.[1] || null,
  };
}

function normalizeQueueEntry(entry) {
  if (Array.isArray(entry)) {
    return {
      priority: entry[0],
      promptId: String(entry[1] || ""),
      prompt: entry[2],
      extraData: entry[3],
      outputsToExecute: entry[4],
    };
  }
  if (entry && typeof entry === "object") {
    return {
      priority: entry.priority,
      promptId: String(entry.prompt_id || entry.number || ""),
      prompt: entry.prompt,
      extraData: entry.extra_data,
      outputsToExecute: entry.outputs_to_execute,
    };
  }
  return { promptId: "" };
}

function collectPromptIds(queueData) {
  const ids = new Set();
  if (!queueData || typeof queueData !== "object") {
    return ids;
  }
  for (const key of ["queue_running", "queue_pending"]) {
    const items = queueData[key] || [];
    if (!Array.isArray(items)) {
      continue;
    }
    for (const item of items) {
      const normalized = normalizeQueueEntry(item);
      if (normalized.promptId) {
        ids.add(normalized.promptId);
      }
    }
  }
  return ids;
}

function detectNewPromptId(queueData, baselineIds = new Set()) {
  if (!queueData) {
    return null;
  }
  for (const key of ["queue_running", "queue_pending"]) {
    const items = queueData[key] || [];
    if (!Array.isArray(items)) {
      continue;
    }
    for (const item of items) {
      const normalized = normalizeQueueEntry(item);
      if (normalized.promptId && !baselineIds.has(normalized.promptId)) {
        return normalized.promptId;
      }
    }
  }
  return null;
}

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) {
    return `${min}m${String(sec).padStart(2, "0")}s`;
  }
  return `${sec}s`;
}

function summarizeProgress({
  queueData,
  historyItem,
  promptId,
  elapsedMs = 0,
  baselineIds = new Set(),
}) {
  const running = (queueData?.queue_running || []).map(normalizeQueueEntry);
  const pending = (queueData?.queue_pending || []).map(normalizeQueueEntry);
  const trackedId = promptId || detectNewPromptId(queueData, baselineIds);

  let phase = "idle";
  let message = "ComfyUI 空闲";
  let currentNode = null;

  if (historyItem?.outputs && Object.keys(historyItem.outputs).length > 0) {
    phase = "completed";
    const outputCount = Object.keys(historyItem.outputs).length;
    message = `已完成 · ${outputCount} 个输出节点 · 用时 ${formatElapsed(elapsedMs)}`;
  } else if (trackedId && running.some((item) => item.promptId === trackedId)) {
    phase = "running";
    const active = running.find((item) => item.promptId === trackedId);
    if (Array.isArray(active?.outputsToExecute) && active.outputsToExecute.length) {
      currentNode = String(active.outputsToExecute[0]);
    }
    message = `运行中 · ${trackedId.slice(0, 8)}… · 已 ${formatElapsed(elapsedMs)}`;
    if (currentNode) {
      message += ` · 节点 ${currentNode}`;
    }
  } else if (trackedId && pending.some((item) => item.promptId === trackedId)) {
    phase = "queued";
    const index = pending.findIndex((item) => item.promptId === trackedId) + 1;
    message = `排队中 · 位置 ${index}/${pending.length} · ${trackedId.slice(0, 8)}…`;
  } else if (running.length || pending.length) {
    phase = "running";
    message = `ComfyUI 队列 · 运行 ${running.length} · 排队 ${pending.length}`;
  }

  const status = historyItem?.status;
  if (status?.status_str && status.status_str !== "success" && phase !== "completed") {
    phase = "failed";
    message = `失败 · ${status.status_str}`;
  }

  return {
    phase,
    message,
    promptId: trackedId || null,
    runningCount: running.length,
    pendingCount: pending.length,
    currentNode,
    elapsedMs,
    elapsedLabel: formatElapsed(elapsedMs),
    outputs: historyItem?.outputs || null,
  };
}

async function fetchQueue(apiUrl) {
  const base = String(apiUrl || "").replace(/\/$/, "");
  if (!base) {
    throw new Error("未配置 ComfyUI API");
  }
  const response = await axios.get(`${base}/queue`, { timeout: 5000 });
  return response.data || { queue_running: [], queue_pending: [] };
}

async function fetchPromptHistory(apiUrl, promptId) {
  const base = String(apiUrl || "").replace(/\/$/, "");
  if (!base || !promptId) {
    return null;
  }
  try {
    const response = await axios.get(`${base}/history/${promptId}`, { timeout: 8000 });
    const data = response.data || {};
    if (data[promptId]) {
      return data[promptId];
    }
    return data;
  } catch {
    return null;
  }
}

async function pingComfyUi(apiUrl) {
  const base = String(apiUrl || "").replace(/\/$/, "");
  if (!base) {
    return { running: false, error: "未配置 ComfyUI API" };
  }

  try {
    const [statsRes, queueRes] = await Promise.all([
      axios.get(`${base}/system_stats`, { timeout: 4000 }),
      axios.get(`${base}/queue`, { timeout: 4000 }).catch(() => ({ data: null })),
    ]);

    const queueData = queueRes?.data || { queue_running: [], queue_pending: [] };
    const running = queueData.queue_running || [];
    const pending = queueData.queue_pending || [];

    return {
      running: true,
      api: base,
      stats: statsRes.data || null,
      queue: queueData,
      queueRunning: Array.isArray(running) ? running.length : 0,
      queuePending: Array.isArray(pending) ? pending.length : 0,
    };
  } catch (error) {
    return {
      running: false,
      api: base,
      error: error.message,
    };
  }
}

async function getComfyUiStatus(paiRoot) {
  const configured = readConfiguredComfyUi(paiRoot);
  if (!configured?.api) {
    return {
      configured: configured || null,
      running: false,
      error: configured?.path ? "PAI 配置中缺少 ComfyUI API 地址" : "未在 PAI 配置中找到 ComfyUI",
    };
  }

  const ping = await pingComfyUi(configured.api);
  return {
    configured,
    ...ping,
    path: configured.path,
    api: configured.api,
  };
}

async function getProgressSnapshot(paiRoot, options = {}) {
  const configured = readConfiguredComfyUi(paiRoot);
  if (!configured?.api) {
    return {
      ok: false,
      phase: "offline",
      message: "ComfyUI API 未配置",
    };
  }

  const startedAt = options.startedAt || Date.now();
  const elapsedMs = Date.now() - startedAt;
  const baselineIds = options.baselineIds instanceof Set ? options.baselineIds : new Set(options.baselineIds || []);
  let promptId = options.promptId || null;

  let queueData = { queue_running: [], queue_pending: [] };
  try {
    queueData = await fetchQueue(configured.api);
  } catch (error) {
    return {
      ok: false,
      phase: "offline",
      message: `ComfyUI 不可达：${error.message}`,
      elapsedMs,
    };
  }

  if (!promptId) {
    promptId = detectNewPromptId(queueData, baselineIds);
  }

  let historyItem = null;
  if (promptId) {
    historyItem = await fetchPromptHistory(configured.api, promptId);
  }

  const progress = summarizeProgress({
    queueData,
    historyItem,
    promptId,
    elapsedMs,
    baselineIds,
  });

  return {
    ok: true,
    api: configured.api,
    queue: queueData,
    history: historyItem,
    ...progress,
  };
}

async function deleteQueuedPrompt(api, promptId) {
  await axios.post(`${api}/queue`, { delete: [String(promptId)] }, { timeout: 8000 });
}

/** Targeted interrupt only — never falls back to bare global `/interrupt`. */
async function interruptRunningPromptTargeted(api, promptId) {
  if (!promptId) {
    throw new Error("定向中断需要 prompt_id");
  }
  await axios.post(
    `${api}/interrupt`,
    { prompt_id: String(promptId) },
    { timeout: 8000 }
  );
}

async function interruptGlobal(api) {
  await axios.post(`${api}/interrupt`, {}, { timeout: 8000 });
}

async function fetchComfyUiVersion(apiUrl) {
  const base = String(apiUrl || "").replace(/\/$/, "");
  if (!base) return null;
  try {
    const response = await axios.get(`${base}/system_stats`, { timeout: 4000 });
    return response.data?.system?.comfyui_version || response.data?.comfyui_version || null;
  } catch {
    return null;
  }
}

async function detectInterruptCapabilities(apiUrl) {
  const version = await fetchComfyUiVersion(apiUrl);
  const targeted = supportsTargetedInterrupt(version);
  return {
    version: version || null,
    supportsTargetedInterrupt: targeted,
    minTargetedInterruptVersion: MIN_TARGETED_INTERRUPT_VERSION,
  };
}

/**
 * Cancel a MOGU-owned ComfyUI job when an explicit promptId is provided.
 * Without promptId, refuse global clear unless forceGlobal=true (after UI confirm).
 * Running cancel without targeted-interrupt support also requires forceGlobal.
 */
async function cancelComfyUiJob(paiRoot, options = {}) {
  const promptId = options.promptId ? String(options.promptId) : null;
  const forceGlobal = options.forceGlobal === true;
  const configured = readConfiguredComfyUi(paiRoot);
  const api = (configured?.api || "").replace(/\/$/, "");
  if (!api) {
    return { ok: false, error: "ComfyUI API 未配置" };
  }

  const caps = await detectInterruptCapabilities(api);

  let queueData;
  try {
    queueData = await fetchQueue(api);
  } catch (error) {
    return { ok: false, error: `无法读取 ComfyUI 队列：${error.message}`, api, ...caps };
  }

  const running = (queueData.queue_running || []).map(normalizeQueueEntry);
  const pending = (queueData.queue_pending || []).map(normalizeQueueEntry);
  const runningId = running[0]?.promptId || null;

  if (promptId) {
    const inPending = pending.some((item) => item.promptId === promptId);
    const inRunning = running.some((item) => item.promptId === promptId);
    const actions = { deleted: false, interrupted: false, clearQueue: false };

    if (!inPending && !inRunning) {
      return {
        ok: true,
        precise: true,
        alreadyGone: true,
        promptId,
        message: `未在队列中找到任务 ${promptId.slice(0, 8)}…（可能已结束）`,
        api,
        ...caps,
        ...actions,
      };
    }

    // Pending delete is always precise (queue delete API).
    if (inPending && !inRunning) {
      try {
        await deleteQueuedPrompt(api, promptId);
        actions.deleted = true;
      } catch (error) {
        return {
          ok: false,
          precise: true,
          promptId,
          error: `精确移除排队任务失败：${error.message}`,
          api,
          ...caps,
          ...actions,
        };
      }
      return {
        ok: true,
        precise: true,
        promptId,
        message: `已从队列移除 MOGU 任务 ${promptId.slice(0, 8)}…`,
        api,
        ...caps,
        ...actions,
      };
    }

    // Running: only precise if ComfyUI supports prompt_id interrupt.
    if (inRunning && !caps.supportsTargetedInterrupt) {
      if (!forceGlobal) {
        return {
          ok: false,
          needsConfirmation: true,
          reason: "no_targeted_interrupt",
          promptId,
          runningCount: running.length,
          pendingCount: pending.length,
          runningPromptId: runningId,
          message:
            `当前 ComfyUI${caps.version ? ` ${caps.version}` : ""} 不支持按 prompt_id 定向中断` +
            `（需要 ≥ ${MIN_TARGETED_INTERRUPT_VERSION}）。` +
            "若继续，将全局中断当前任务并清空队列，可能影响其他任务。",
          api,
          ...caps,
          ...actions,
        };
      }
      // Confirmed global path below after pending cleanup if needed.
    } else if (inRunning && caps.supportsTargetedInterrupt) {
      try {
        if (inPending) {
          await deleteQueuedPrompt(api, promptId);
          actions.deleted = true;
        }
        await interruptRunningPromptTargeted(api, promptId);
        actions.interrupted = true;
      } catch (error) {
        return {
          ok: false,
          precise: true,
          promptId,
          error: `定向中断失败（未回退为全局中断）：${error.message}`,
          api,
          ...caps,
          ...actions,
        };
      }
      return {
        ok: true,
        precise: true,
        promptId,
        message: `已精确中断 MOGU 任务 ${promptId.slice(0, 8)}…`,
        api,
        ...caps,
        ...actions,
      };
    }
  }

  if (!forceGlobal) {
    return {
      ok: false,
      needsConfirmation: true,
      reason: promptId ? "no_targeted_interrupt" : "missing_prompt_id",
      promptId,
      runningCount: running.length,
      pendingCount: pending.length,
      runningPromptId: runningId,
      message: promptId
        ? `无法对运行中的任务做定向中断。若继续，将全局中断并清空队列，可能影响其他任务。`
        : "未绑定当前任务的 promptId。若继续，将中断 ComfyUI 当前任务并清空整队列，可能影响其他人的任务。",
      api,
      ...caps,
    };
  }

  const results = { interrupted: false, clearQueue: false, precise: false, forceGlobal: true };
  try {
    // After explicit user confirmation only — bare global interrupt.
    await interruptGlobal(api);
    results.interrupted = true;
  } catch (error) {
    return { ok: false, error: `中断失败：${error.message}`, api, ...caps, ...results };
  }
  try {
    await axios.post(`${api}/queue`, { clear: true }, { timeout: 8000 });
    results.clearQueue = true;
  } catch {
    // best-effort
  }
  return {
    ok: true,
    message: "已按确认执行全局取消：中断当前任务并清空队列",
    api,
    ...caps,
    ...results,
  };
}

/**
 * @deprecated Prefer cancelComfyUiJob with explicit promptId. Kept for compatibility.
 */
async function interruptComfyUi(paiRoot) {
  return cancelComfyUiJob(paiRoot, { forceGlobal: true });
}

/**
 * Open ComfyUI web UI, bypassing dead HTTP_PROXY (Edge ERR_PROXY_CONNECTION_FAILED).
 */
async function openComfyUiInBrowser(paiRoot) {
  const { spawn } = require("child_process");
  const { shell } = require("electron");
  const status = await getComfyUiStatus(paiRoot);
  const api = (status.api || status.configured?.api || "http://127.0.0.1:8189").replace(/\/$/, "");
  const url = `${api}/`;

  if (!status.running) {
    const start = status.configured?.start_command || status.startScript;
    // best-effort: caller may start via butler; still return URL
    return {
      ok: false,
      running: false,
      url,
      error: "ComfyUI API 未运行。请先启动 ComfyUI，或在管家说「打开 ComfyUI」。",
      path: status.path || status.configured?.path || null,
    };
  }

  const bypass = "<-loopback>;127.0.0.1;localhost";
  for (const browser of ["msedge", "chrome"]) {
    try {
      spawn(browser, [`--proxy-bypass-list=${bypass}`, url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: true,
      }).unref();
      return { ok: true, running: true, url, method: browser, path: status.path };
    } catch {
      // try next
    }
  }

  await shell.openExternal(url);
  return { ok: true, running: true, url, method: "shell.openExternal", path: status.path };
}

module.exports = {
  MIN_TARGETED_INTERRUPT_VERSION,
  parseVersionParts,
  compareSemver,
  supportsTargetedInterrupt,
  readConfiguredComfyUi,
  normalizeQueueEntry,
  collectPromptIds,
  detectNewPromptId,
  summarizeProgress,
  fetchQueue,
  fetchPromptHistory,
  pingComfyUi,
  getComfyUiStatus,
  getProgressSnapshot,
  formatElapsed,
  detectInterruptCapabilities,
  cancelComfyUiJob,
  interruptComfyUi,
  openComfyUiInBrowser,
};

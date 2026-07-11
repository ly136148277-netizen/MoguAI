const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

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

module.exports = {
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
};

/**
 * mogu.browser — 打开网页、HTTP 抓取、Playwright 点击/填表/提取（外置引擎）
 */

const { spawnSync } = require("child_process");
const {
  resolvePlaywrightHint,
  normalizeUrl,
  normalizeSteps,
  runPlaywrightActions,
} = require("../browser-engine");

function pickUrl(args = {}) {
  return String(args.url || args.href || args.target || args.query || "").trim();
}

async function openExternalUrl(deps, url) {
  if (typeof deps?.openExternal === "function") {
    await deps.openExternal(url);
    return;
  }
  try {
    const { shell } = require("electron");
    if (shell?.openExternal) {
      await shell.openExternal(url);
      return;
    }
  } catch {
    /* not in Electron */
  }
  if (process.platform === "win32") {
    spawnSync("cmd", ["/c", "start", "", url], { windowsHide: true });
  } else {
    spawnSync("xdg-open", [url], { windowsHide: true });
  }
}

function fixPayload(probe) {
  const fixCommands = probe?.fixCommands || [];
  return {
    fixCommands,
    fixText: fixCommands.length
      ? [`${probe.message || "Playwright 未就绪"}`, "", "可复制命令：", ...fixCommands.map((c) => `  ${c}`)].join(
          "\n"
        )
      : probe?.message || "",
  };
}

async function status({ deps }) {
  const playwright = resolvePlaywrightHint(deps.settings || {});
  return {
    ok: true,
    openExternal: true,
    playwright,
    ...fixPayload(playwright),
  };
}

async function preflight({ deps, args }) {
  const issues = [];
  const needsPw = ["act", "click", "fill", "extract", "run"].includes(String(args?.op || "")) &&
    (args?.engine === "playwright" || args?.op === "act" || args?.op === "click" || args?.op === "fill");
  const url = pickUrl(args);
  if ((args?.op === "fetch" || args?.engine === "playwright") && !url && !args?.steps?.length) {
    issues.push({ code: "url_missing", message: "缺少 url 或 steps" });
  }
  const probe = resolvePlaywrightHint(deps.settings || {});
  if (needsPw && !probe.installed) {
    issues.push({
      code: "playwright_missing",
      message: probe.message || "Playwright 未就绪",
      ...fixPayload(probe),
    });
  }
  return { ok: issues.length === 0, issues, playwright: probe, url };
}

async function open({ deps, args }) {
  const url = normalizeUrl(pickUrl(args));
  if (!url) return { ok: false, error: "缺少 url", code: "url_missing" };
  try {
    await openExternalUrl(deps, url);
    return { ok: true, url, mode: "external" };
  } catch (error) {
    return { ok: false, error: error.message || String(error), url };
  }
}

async function fetchPage({ args }) {
  const url = normalizeUrl(pickUrl(args));
  if (!url) return { ok: false, error: "缺少 url", code: "url_missing" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(args?.timeoutMs) || 25000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "MOGU-AI/2.1 browser-skill",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    const html = await response.text();
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, url };
    }
    const text = stripHtml(html).slice(0, Math.min(12000, Number(args?.maxChars) || 8000));
    return {
      ok: true,
      url,
      status: response.status,
      title: (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || "",
      text,
      mode: "http_fetch",
    };
  } catch (error) {
    if (error.name === "AbortError") return { ok: false, error: "抓取超时", url };
    return { ok: false, error: error.message || String(error), url };
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function act({ deps, args }) {
  const steps = normalizeSteps({ ...args, op: args?.op || "act" });
  if (!steps.length) {
    return { ok: false, error: "缺少 steps / url / selector", code: "steps_empty" };
  }
  const result = await runPlaywrightActions({
    settings: deps.settings || {},
    steps,
    headless: args?.headless !== false,
    timeoutMs: Number(args?.timeoutMs) || 120000,
  });
  return result;
}

async function click(ctx) {
  return act({
    deps: ctx.deps,
    args: { ...ctx.args, op: "click", steps: normalizeSteps({ ...ctx.args, op: "click" }) },
  });
}

async function fill(ctx) {
  return act({
    deps: ctx.deps,
    args: { ...ctx.args, op: "fill", steps: normalizeSteps({ ...ctx.args, op: "fill" }) },
  });
}

async function extract(ctx) {
  const args = ctx.args || {};
  const engine = String(args.engine || "fetch").toLowerCase();
  if (engine === "playwright" || args.usePlaywright) {
    return act({
      deps: ctx.deps,
      args: { ...args, op: "extract", steps: normalizeSteps({ ...args, op: "extract" }) },
    });
  }
  return fetchPage({ args });
}

async function run({ deps, args }) {
  const engine = String(args?.engine || args?.mode || "fetch").toLowerCase();
  if (engine === "open") return open({ deps, args });
  if (engine === "playwright" || engine === "act" || Array.isArray(args?.steps)) {
    return act({ deps, args });
  }
  return fetchPage({ args });
}

module.exports = {
  id: "mogu.browser",
  status,
  preflight,
  open,
  fetch: fetchPage,
  act,
  click,
  fill,
  extract,
  run,
  pickUrl,
  resolvePlaywrightHint,
};

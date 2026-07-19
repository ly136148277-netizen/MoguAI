/**
 * mogu.browser — 打开网页；HTTP 抓取正文；可选本机 Playwright（外置，不打进安装包）
 */

const { spawnSync } = require("child_process");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");

function pickUrl(args = {}) {
  return String(args.url || args.href || args.target || args.query || "").trim();
}

function normalizeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function resolvePlaywrightHint(settings = {}) {
  const custom = String(settings.browserPlaywrightPath || "").trim();
  if (custom && fs.pathExistsSync(custom)) {
    return { kind: "path", path: custom, installed: true };
  }
  const vendorRoot = String(settings.codingVendorRoot || process.env.MOGU_VENDOR_ROOT || "").trim();
  if (vendorRoot) {
    const vendor = path.join(vendorRoot, "playwright");
    if (fs.pathExistsSync(path.join(vendor, "package.json"))) {
      return { kind: "vendor", path: vendor, installed: true };
    }
  }
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["npx"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (which.status === 0) {
    return {
      kind: "npx",
      installed: true,
      message: "可用 npx；fetch/open 不依赖 Playwright",
    };
  }
  return {
    kind: "none",
    installed: false,
    message: "Playwright 未配置；open / fetch 仍可用",
  };
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

async function status({ deps }) {
  return {
    ok: true,
    openExternal: true,
    playwright: resolvePlaywrightHint(deps.settings || {}),
  };
}

async function preflight({ deps, args }) {
  const issues = [];
  const url = pickUrl(args);
  if ((args?.op === "fetch" || args?.op === "run" || args?.engine === "playwright") && !url) {
    issues.push({ code: "url_missing", message: "缺少 url" });
  }
  const probe = resolvePlaywrightHint(deps.settings || {});
  if (args?.engine === "playwright" && !probe.installed) {
    issues.push({
      code: "playwright_missing",
      message: probe.message || "Playwright 未就绪",
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

async function runPlaywright({ deps, args }) {
  const url = normalizeUrl(pickUrl(args));
  if (!url) return { ok: false, error: "缺少 url", code: "url_missing" };
  const probe = resolvePlaywrightHint(deps.settings || {});
  if (!probe.installed) {
    return {
      ok: false,
      code: "playwright_missing",
      error: probe.message || "Playwright 未安装",
      hint: "可改用 op=fetch 或 op=open",
    };
  }

  const script = `
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(process.env.MOGU_BROWSER_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  const title = await page.title();
  const text = await page.innerText("body");
  process.stdout.write(JSON.stringify({ ok: true, title, text: String(text || "").slice(0, 8000) }));
  await browser.close();
})().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  process.exitCode = 1;
});
`;
  const tmp = path.join(os.tmpdir(), `mogu-browser-${Date.now()}.js`);
  await fs.writeFile(tmp, script, "utf8");
  const env = { ...process.env, MOGU_BROWSER_URL: url };
  if (probe.kind === "vendor" || probe.kind === "path") {
    env.NODE_PATH = [path.join(probe.path, "node_modules"), env.NODE_PATH].filter(Boolean).join(path.delimiter);
  }
  try {
    const nodeRun = spawnSync("node", [tmp], {
      encoding: "utf8",
      env,
      windowsHide: true,
      timeout: 90000,
    });
    const line = String(nodeRun.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();
    if (line) {
      try {
        return { ...JSON.parse(line), url, mode: "playwright" };
      } catch {
        /* fall through */
      }
    }
    return {
      ok: false,
      error: (nodeRun.stderr || nodeRun.stdout || "Playwright 执行失败").slice(0, 500),
      url,
      mode: "playwright",
    };
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
}

async function run({ deps, args }) {
  const engine = String(args?.engine || args?.mode || "fetch").toLowerCase();
  if (engine === "open") return open({ deps, args });
  if (engine === "playwright") return runPlaywright({ deps, args });
  return fetchPage({ args });
}

module.exports = {
  id: "mogu.browser",
  status,
  preflight,
  open,
  fetch: fetchPage,
  run,
  pickUrl,
  resolvePlaywrightHint,
};

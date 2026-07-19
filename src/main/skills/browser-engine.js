/**
 * External Playwright runner for mogu.browser act/click/fill/extract.
 * Playwright is NOT bundled; uses npx/vendor/path like coding engines.
 */

const { spawnSync } = require("child_process");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");

function whichSync(cmd) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [cmd], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  return (
    String(result.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean) || null
  );
}

function resolvePlaywrightHint(settings = {}) {
  const custom = String(settings.browserPlaywrightPath || "").trim();
  if (custom && fs.pathExistsSync(custom)) {
    return {
      kind: "path",
      path: custom,
      installed: true,
      message: "就绪（自定义路径）",
      fixCommands: [],
    };
  }
  const vendorRoot = String(
    settings.codingVendorRoot || process.env.MOGU_VENDOR_ROOT || process.env.MOGU_CODING_VENDOR || ""
  ).trim();
  if (vendorRoot) {
    const vendor = path.join(vendorRoot, "playwright");
    if (fs.pathExistsSync(path.join(vendor, "package.json"))) {
      return {
        kind: "vendor",
        path: vendor,
        installed: true,
        message: "就绪（vendor）",
        fixCommands: [],
      };
    }
  }
  // Try require.resolve from cwd
  try {
    const resolved = require.resolve("playwright", { paths: [process.cwd()] });
    if (resolved) {
      return {
        kind: "node_modules",
        path: path.dirname(path.dirname(resolved)),
        installed: true,
        message: "就绪（本机 node_modules）",
        fixCommands: [],
      };
    }
  } catch {
    /* ignore */
  }
  if (whichSync("npx")) {
    return {
      kind: "npx",
      installed: true,
      message: "可用 npx（首次可能下载 Chromium）",
      fixCommands: ["npm i -D playwright", "npx playwright install chromium"],
    };
  }
  return {
    kind: "none",
    installed: false,
    message: "未检测到 Playwright；open/fetch 仍可用",
    fixCommands: ["npm i -D playwright", "npx playwright install chromium"],
  };
}

function normalizeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function normalizeSteps(args = {}) {
  if (Array.isArray(args.steps) && args.steps.length) {
    return args.steps.map(normalizeStep).filter(Boolean);
  }
  const url = normalizeUrl(args.url || args.href);
  const steps = [];
  if (url) steps.push({ action: "goto", url });
  const op = String(args.op || args.action || "").toLowerCase();
  if (op === "click" || args.selector && args.value == null && op !== "fill") {
    if (args.selector) steps.push({ action: "click", selector: String(args.selector) });
  }
  if (op === "fill" || (args.selector && args.value != null)) {
    steps.push({
      action: "fill",
      selector: String(args.selector || ""),
      value: String(args.value ?? args.text ?? ""),
    });
  }
  if (op === "extract" || args.extract) {
    steps.push({
      action: "extract",
      selector: String(args.selector || args.extract || "body"),
    });
  }
  if (op === "press" && args.key) {
    steps.push({ action: "press", key: String(args.key) });
  }
  if (!steps.length && url) {
    steps.push({ action: "extract", selector: "body" });
  }
  return steps.filter(Boolean);
}

function normalizeStep(step) {
  if (!step || typeof step !== "object") return null;
  const action = String(step.action || step.op || step.type || "").toLowerCase();
  if (!action) return null;
  return {
    action,
    url: step.url ? normalizeUrl(step.url) : undefined,
    selector: step.selector != null ? String(step.selector) : undefined,
    value: step.value != null ? String(step.value) : step.text != null ? String(step.text) : undefined,
    key: step.key != null ? String(step.key) : undefined,
    ms: step.ms != null ? Number(step.ms) : step.timeoutMs != null ? Number(step.timeoutMs) : undefined,
  };
}

function buildRunnerScript() {
  return `
const { chromium } = require("playwright");
const steps = JSON.parse(process.env.MOGU_BROWSER_STEPS || "[]");
const headless = process.env.MOGU_BROWSER_HEADLESS !== "0";
(async () => {
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();
  const log = [];
  let extract = "";
  let title = "";
  let finalUrl = "";
  try {
    for (const step of steps) {
      const action = String(step.action || "").toLowerCase();
      if (action === "goto") {
        await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        log.push({ action, url: step.url, ok: true });
      } else if (action === "click") {
        await page.click(step.selector, { timeout: 20000 });
        log.push({ action, selector: step.selector, ok: true });
      } else if (action === "fill") {
        await page.fill(step.selector, step.value == null ? "" : String(step.value), { timeout: 20000 });
        log.push({ action, selector: step.selector, ok: true });
      } else if (action === "press") {
        await page.keyboard.press(step.key || "Enter");
        log.push({ action, key: step.key || "Enter", ok: true });
      } else if (action === "wait") {
        await page.waitForTimeout(Math.min(30000, Math.max(0, Number(step.ms) || 1000)));
        log.push({ action, ms: step.ms || 1000, ok: true });
      } else if (action === "extract") {
        const sel = step.selector || "body";
        extract = await page.innerText(sel);
        extract = String(extract || "").slice(0, 8000);
        log.push({ action, selector: sel, ok: true, chars: extract.length });
      } else {
        log.push({ action, ok: false, error: "unsupported_action" });
      }
    }
    title = await page.title();
    finalUrl = page.url();
    if (!extract) {
      extract = String(await page.innerText("body") || "").slice(0, 4000);
    }
    process.stdout.write(JSON.stringify({ ok: true, title, url: finalUrl, text: extract, steps: log }));
  } catch (e) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: String(e && e.message || e),
      title: title || "",
      url: finalUrl || page.url(),
      steps: log,
    }));
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
})();
`;
}

async function runPlaywrightActions({ settings = {}, steps = [], headless = true, timeoutMs = 120000 } = {}) {
  const probe = resolvePlaywrightHint(settings);
  if (!probe.installed) {
    return {
      ok: false,
      code: "playwright_missing",
      error: probe.message || "Playwright 未安装",
      fixCommands: probe.fixCommands || [],
      fixText: [
        probe.message,
        "",
        "可复制命令：",
        ...(probe.fixCommands || []).map((c) => `  ${c}`),
      ].join("\n"),
    };
  }
  if (!steps.length) {
    return { ok: false, error: "缺少 steps", code: "steps_empty" };
  }

  const tmp = path.join(os.tmpdir(), `mogu-browser-act-${Date.now()}.js`);
  await fs.writeFile(tmp, buildRunnerScript(), "utf8");
  const env = {
    ...process.env,
    MOGU_BROWSER_STEPS: JSON.stringify(steps),
    MOGU_BROWSER_HEADLESS: headless === false ? "0" : "1",
  };
  if (probe.kind === "vendor" || probe.kind === "path" || probe.kind === "node_modules") {
    env.NODE_PATH = [path.join(probe.path, "node_modules"), probe.path, env.NODE_PATH]
      .filter(Boolean)
      .join(path.delimiter);
  }
  try {
    const nodeRun = spawnSync("node", [tmp], {
      encoding: "utf8",
      env,
      windowsHide: true,
      timeout: timeoutMs,
    });
    const line = String(nodeRun.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();
    if (line) {
      try {
        const parsed = JSON.parse(line);
        return { ...parsed, mode: "playwright", playwright: probe };
      } catch {
        /* fall through */
      }
    }
    return {
      ok: false,
      error: (nodeRun.stderr || nodeRun.stdout || "Playwright 执行失败").slice(0, 800),
      mode: "playwright",
      playwright: probe,
      fixCommands: probe.fixCommands || [],
    };
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
}

module.exports = {
  resolvePlaywrightHint,
  normalizeUrl,
  normalizeSteps,
  normalizeStep,
  runPlaywrightActions,
  whichSync,
};

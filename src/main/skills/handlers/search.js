/**
 * mogu.search — 联网搜索（DuckDuckGo Instant Answer，无需 Key）
 */

const DEFAULT_UA =
  "MOGU-AI/2.1 (+https://github.com/ly136148277-netizen/MoguAI; personal search skill)";

function pickQuery(args = {}) {
  return String(args.query || args.q || args.text || args.command || "").trim();
}

async function preflight() {
  return { ok: true, issues: [], backend: "duckduckgo" };
}

async function status() {
  return { ok: true, backend: "duckduckgo", needsKey: false };
}

async function query({ args }) {
  const q = pickQuery(args);
  if (!q) return { ok: false, error: "缺少 query", code: "query_empty" };

  const limit = Math.min(10, Math.max(1, Number(args?.limit) || 5));
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(args?.timeoutMs) || 20000);
  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": DEFAULT_UA },
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, error: "搜索接口返回非 JSON", code: "bad_response" };
    }
    if (!response.ok) {
      return { ok: false, error: `搜索失败 HTTP ${response.status}`, code: "http_error" };
    }

    const results = [];
    const abstract = String(data.AbstractText || "").trim();
    if (abstract) {
      results.push({
        title: data.Heading || q,
        snippet: abstract,
        url: data.AbstractURL || data.AbstractSource || "",
        source: "abstract",
      });
    }
    const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
    for (const item of flattenRelated(related)) {
      if (results.length >= limit) break;
      results.push(item);
    }

    return {
      ok: true,
      query: q,
      results,
      answer: abstract || results[0]?.snippet || "",
      backend: "duckduckgo",
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, error: "搜索超时", code: "timeout" };
    }
    return { ok: false, error: error.message || String(error), code: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

function flattenRelated(items, out = []) {
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item.Topics)) {
      flattenRelated(item.Topics, out);
      continue;
    }
    const text = String(item.Text || "").trim();
    const url = String(item.FirstURL || "").trim();
    if (!text && !url) continue;
    out.push({
      title: text.split(" - ")[0] || text.slice(0, 80),
      snippet: text,
      url,
      source: "related",
    });
  }
  return out;
}

module.exports = {
  id: "mogu.search",
  status,
  preflight,
  query,
  run: query,
  pickQuery,
};

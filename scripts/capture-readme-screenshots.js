#!/usr/bin/env node
/**
 * Capture README screenshots from the renderer UI (no backend required).
 * Usage: npx electron scripts/capture-readme-screenshots.js
 */

const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const OUT_DIR = path.join(__dirname, "..", "docs", "images");
const RENDERER = path.join(__dirname, "..", "src", "renderer", "index.html");

const PAGES = [
  { file: "01-home", nav: "home", setup: "setupHome" },
  { file: "02-models", nav: "models", setup: "setupModels" },
  { file: "03-chat", nav: "chat", setup: "setupChat" },
  { file: "04-comfyui", nav: "comfyui", setup: "setupComfyui" },
];

function navigateScript(nav) {
  return `(function () {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
    const view = document.getElementById("view-${nav}");
    if (view) view.classList.add("is-active");
    document.querySelectorAll("[data-nav]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.nav === "${nav}");
    });
  })()`;
}

const SETUP_SCRIPTS = {
  setupHome: `(() => {
    const ollama = document.getElementById("ollama-status");
    const text = document.getElementById("ollama-status-text");
    if (ollama) {
      ollama.className = "ollama-status ollama-status--online";
      if (text) text.textContent = "Ollama 已连接 · 11434";
    }
    const storage = document.getElementById("storage-path");
    if (storage) storage.value = "F:\\\\下载\\\\ai-models";
    const badge = document.getElementById("home-import-badge");
    if (badge) badge.textContent = "2 个待导入";
  })()`,

  setupModels: `(() => {
    const list = document.getElementById("model-list");
    if (!list) return;
    list.innerHTML = \`
      <article class="model-card">
        <div class="model-card__top">
          <div><div class="model-card__title">Qwen 2.5 7B Instruct</div>
          <div class="model-card__ollama-name">对话 · 下载后自动导入</div></div>
          <div class="model-card__side"><div class="model-card__size">4.7 GB</div></div>
        </div>
        <p class="model-card__desc">通义千问 2.5 7B，中文表现优秀，适合日常对话与写作。</p>
        <div class="model-card__meta"><div class="model-card__tags"><span class="tag">chat</span><span class="tag">qwen</span></div></div>
        <div class="model-card__actions"><button class="btn btn--primary" type="button">下载</button></div>
      </article>
      <article class="model-card">
        <div class="model-card__top">
          <div><div class="model-card__title">Llama 3 8B Instruct</div>
          <div class="model-card__ollama-name">对话 · 下载后自动导入</div></div>
          <div class="model-card__side"><div class="model-card__size">4.9 GB</div></div>
        </div>
        <p class="model-card__desc">Meta Llama 3 8B，英文与代码任务均衡。</p>
        <div class="model-card__meta"><div class="model-card__tags"><span class="tag">chat</span><span class="tag">llama</span></div></div>
        <div class="model-card__actions"><button class="btn btn--primary" type="button">下载</button></div>
      </article>
      <article class="model-card">
        <div class="model-card__top">
          <div><div class="model-card__title">Phi-3 Mini 4K</div>
          <div class="model-card__ollama-name">轻量 · 下载后自动导入</div></div>
          <div class="model-card__side"><div class="model-card__size">2.3 GB</div></div>
        </div>
        <p class="model-card__desc">微软 Phi-3 Mini，小显存友好，响应快。</p>
        <div class="model-card__meta"><div class="model-card__tags"><span class="tag">chat</span><span class="tag">small</span></div></div>
        <div class="model-card__actions"><button class="btn btn--primary" type="button">下载</button></div>
      </article>\`;
    const search = document.getElementById("search-input");
    if (search) search.placeholder = "搜索 llama、qwen、phi…";
  })()`,

  setupChat: `(() => {
    const picker = document.getElementById("chat-picker");
    const workspace = document.getElementById("chat-workspace");
    if (picker) picker.classList.add("hidden");
    if (workspace) workspace.classList.remove("hidden");
    const messages = document.getElementById("chat-messages");
    if (messages) {
      messages.innerHTML = \`
        <div class="chat-message chat-message--user">
          <div class="chat-message__bubble">用三句话介绍本地大模型和云端 API 的区别。</div>
          <div class="chat-message__meta">You</div>
        </div>
        <div class="chat-message chat-message--assistant">
          <div class="chat-message__bubble"><p><strong>本地模型</strong>跑在你自己的电脑上，数据不出本机，离线可用，但需要下载模型和一定算力。</p>
          <p><strong>云端 API</strong>按调用付费、即开即用，但对话内容会发到服务商，依赖网络。</p>
          <p>蘑菇AI 帮你把本地这条路径做到「下载 → 导入 → 聊天」一条龙。</p></div>
          <div class="chat-message__meta">Token: 186</div>
        </div>\`;
    }
    const title = document.getElementById("chat-session-title");
    if (title) title.textContent = "本地 vs 云端";
    const stats = document.getElementById("chat-token-stats");
    if (stats) stats.textContent = "Token: prompt 42 · completion 144 · total 186";
  })()`,

  setupComfyui: `(() => {
    const dot = document.getElementById("comfyui-status-dot");
    const text = document.getElementById("comfyui-status-text");
    if (dot) dot.classList.add("comfyui-status__dot--online");
    if (text) text.textContent = "ComfyUI 已连接 http://127.0.0.1:8189";
    const hint = document.getElementById("comfyui-workflow-hint");
    if (hint) {
      hint.innerHTML = "下载的工作流 <code>.json</code> 请放入 <strong>E:\\\\projects\\\\PAI\\\\workflows</strong>（推荐），或 ComfyUI 保存目录 <strong>F:\\\\ComfyUI\\\\ComfyUI\\\\user\\\\default\\\\workflows</strong>。点「刷新列表」后 PAI 会解析 JSON 并生成 API prompt。";
    }
    const presets = document.getElementById("comfyui-presets");
    if (presets && !presets.children.length) {
      presets.innerHTML = \`
        <article class="comfyui-preset-card"><h4>确认 zimage</h4><p>zimage_gguf · 文生图</p><button class="btn btn--primary btn--tiny" type="button">运行</button></article>
        <article class="comfyui-preset-card"><h4>确认千问换装</h4><p>qwen_image_edit · 图像编辑</p><button class="btn btn--primary btn--tiny" type="button">运行</button></article>
        <article class="comfyui-preset-card"><h4>确认 ltx i2v</h4><p>LTX 2.3 · 图生视频</p><button class="btn btn--primary btn--tiny" type="button">运行</button></article>\`;
    }
    const catalog = document.getElementById("comfyui-catalog-list");
    if (catalog) {
      catalog.innerHTML = \`
        <div class="comfyui-catalog-item"><span class="badge badge--success">可 API</span><strong>zimage_gguf.json</strong><span>14 nodes</span></div>
        <div class="comfyui-catalog-item"><span class="badge badge--success">可 API</span><strong>qwen_image_edit.json</strong><span>22 nodes</span></div>
        <div class="comfyui-catalog-item"><span class="badge badge--warn">待校验</span><strong>custom_upscale.json</strong><span>8 nodes</span></div>\`;
    }
    const meta = document.getElementById("comfyui-catalog-meta");
    if (meta) meta.textContent = "已同步 14 个工作流 · 12 可 API";
  })()`,
};

async function capturePage(win, filename) {
  const image = await win.webContents.capturePage();
  const outPath = path.join(OUT_DIR, `${filename}.png`);
  fs.writeFileSync(outPath, image.toPNG());
  console.log(`[ok] ${outPath}`);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    backgroundColor: "#0f1419",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  await win.loadFile(RENDERER);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  for (const page of PAGES) {
    await win.webContents.executeJavaScript(navigateScript(page.nav));
    await win.webContents.executeJavaScript(SETUP_SCRIPTS[page.setup]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await capturePage(win, page.file);
  }

  app.quit();
});

app.on("window-all-closed", () => app.quit());

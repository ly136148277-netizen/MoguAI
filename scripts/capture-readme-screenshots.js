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
  { file: "01-home-v153", nav: "home", setup: "setupHome" },
  { file: "02-agent-models-v153", nav: "models", setup: "setupModels" },
  { file: "03-agent-v153", nav: "chat", setup: "setupAgent" },
  { file: "04-studio-v153", nav: "studio", setup: "setupStudio" },
  { file: "05-compose-v153", nav: "compose", setup: "setupCompose" },
  { file: "06-setup-v153", nav: "setup", setup: "setupEnvironment" },
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
    const states = [
      ["home-light-ollama", "Ollama 已就绪"],
      ["home-light-pai", "PAI 已连接"],
      ["home-light-comfy", "ComfyUI 已连接"],
      ["home-light-ffmpeg", "FFmpeg 已就绪"],
      ["home-goto-setup-btn", "环境正常"],
    ];
    states.forEach(([id, label]) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = label;
        el.classList.add("is-ok");
      }
    });
    const badge = document.getElementById("home-import-badge");
    if (badge) badge.textContent = "0";
    const hint = document.getElementById("home-import-hint");
    if (hint) hint.textContent = "当前没有待导入模型";
    const downloads = document.getElementById("recent-downloads");
    if (downloads) downloads.innerHTML = "<li>Qwen 2.5 7B · 已完成</li>";
    const sessions = document.getElementById("recent-sessions");
    if (sessions) sessions.innerHTML = "<li>本地 Agent 使用说明</li>";
    const imported = document.getElementById("recent-imported");
    if (imported) imported.innerHTML = "<li>Qwen 2.5 7B · Ollama</li>";
  })()`,

  setupModels: `(() => {
    const gate = document.getElementById("models-gate");
    const local = document.getElementById("models-local");
    if (gate) gate.classList.add("hidden");
    if (local) local.classList.remove("hidden");
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
    const count = document.getElementById("model-count");
    if (count) count.textContent = "8 个模型";
    const search = document.getElementById("search-input");
    if (search) search.placeholder = "搜索 llama、qwen、phi…";
  })()`,

  setupAgent: `(() => {
    const messages = document.getElementById("agent-messages");
    if (messages) {
      messages.innerHTML = \`
        <article class="butler-message butler-message--assistant">
          <div class="butler-message__body"><strong>MOGU AI Agent 已就绪</strong><br>可以打开 ComfyUI、列出工作流、搜索文件、备份项目，也可以问我怎么使用创作台。</div>
        </article>
        <article class="butler-message butler-message--user">
          <div class="butler-message__body">帮我列出可以做图生视频的工作流</div>
        </article>
        <article class="butler-message butler-message--assistant">
          <div class="butler-message__body">找到 6 个图生视频工作流。你可以点击右上角「去创作台」，选择工作流后填写人物和动作描述并执行。</div>
        </article>\`;
    }
    const status = document.getElementById("agent-status-text");
    if (status) status.textContent = "PAI 已连接 · Agent 可用";
  })()`,

  setupStudio: `(() => {
    const env = [
      ["studio-env-ollama", "Ollama 已就绪"],
      ["studio-env-pai", "PAI 已连接"],
      ["studio-env-comfy", "ComfyUI 已连接"],
      ["studio-env-ffmpeg", "FFmpeg 已就绪"],
      ["studio-env-all", "环境正常"],
    ];
    env.forEach(([id, label]) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = label;
        el.classList.add("is-ok");
      }
    });
    const character = document.getElementById("studio-character");
    if (character) character.value = "一位穿红色长裙的东亚女性，电影级光影，人物细节清晰";
    const action = document.getElementById("studio-action");
    if (action) action.value = "缓缓转身看向镜头，发丝随风飘动，镜头平稳推进";
    const t2i = document.getElementById("studio-t2i-name");
    if (t2i) t2i.textContent = "Z-Image 文生图";
    const i2v = document.getElementById("studio-i2v-name");
    if (i2v) i2v.textContent = "LTX 2.3 图生视频";
    const size = document.getElementById("studio-size");
    if (size) size.value = "720x1280";
    const clarity = document.getElementById("studio-clarity");
    if (clarity) clarity.value = "standard";
    const duration = document.getElementById("studio-duration");
    if (duration) duration.value = "5";
  })()`,

  setupCompose: `(() => {
    const track = document.getElementById("compose-timeline-track");
    if (track) {
      track.innerHTML = \`
        <button type="button" class="compose-tl-add">+</button>
        <div class="compose-tl-clip">
          <div class="compose-tl-clip__head"><span>镜头 01 · 开场</span></div>
          <div class="compose-tl-clip__body"><div class="compose-tl-clip__placeholder">5 秒短片</div></div>
        </div>
        <button type="button" class="compose-tl-add">+</button>
        <div class="compose-tl-clip">
          <div class="compose-tl-clip__head"><span>镜头 02 · 转身</span></div>
          <div class="compose-tl-clip__body"><div class="compose-tl-clip__placeholder">5 秒短片</div></div>
        </div>
        <button type="button" class="compose-tl-add">+</button>
        <div class="compose-tl-clip">
          <div class="compose-tl-clip__head"><span>镜头 03 · 结尾</span></div>
          <div class="compose-tl-clip__body"><div class="compose-tl-clip__placeholder">5 秒短片</div></div>
        </div>
        <button type="button" class="compose-tl-add">+</button>\`;
    }
  })()`,

  setupEnvironment: `(() => {
    [
      ["setup-ollama-badge", "已安装 · 已运行"],
      ["setup-pai-badge", "已安装 · 已连接"],
      ["setup-comfy-badge", "已找到 · 已连接"],
      ["setup-ffmpeg-badge", "已就绪"],
    ].forEach(([id, label]) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = label;
        el.classList.add("badge--success");
      }
    });
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
    height: 900,
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

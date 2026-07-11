# ComfyUI Workflows · 工作流指南

**English** | [中文](#中文)

> For developers / smoke tests see [`BUTLER_SMOKE.md`](./BUTLER_SMOKE.md).

---

## Where do I put downloaded workflow JSON?

Mogu AI does **not** store workflows inside the app folder. Put `.json` files in one of these folders — PAI will find them automatically:

| Folder | Best for |
|--------|----------|
| **`{PAI root}/workflows/`** *(recommended)* | Workflows you download from Civitai, GitHub, etc. Example: `E:\projects\PAI\workflows\` |
| **`{ComfyUI}/ComfyUI/user/default/workflows/`** | Workflows you **Save** inside the ComfyUI UI |

Optional: add extra folders in PAI’s `pai.yaml` → `video_factory.extra_dirs`.

### First-time setup

1. Install **PAI** and start `pai serve` (default `http://127.0.0.1:8765`).
2. In Mogu AI → **AI Butler** → click **Detect local setup** — this writes your ComfyUI install path to `pai.yaml` (not the workflow folder).
3. Copy your `.json` files into `{PAI root}/workflows/`.
4. Open **ComfyUI Render** → click **Refresh list** (or type `sync workflows` in the butler).

The panel shows your **actual paths** on screen — use those if your PAI root differs from the examples above.

---

## Does it auto-read and extract API data?

**Yes — this is already built in** (shipped with Mogu AI v1.3+ / PAI gateway).

When you refresh the workflow list, PAI will:

1. **Scan** both folders above for `.json` files  
2. **Parse** each workflow graph  
3. **Validate** nodes against your running ComfyUI (`object_info`)  
4. **Extract** an API-ready prompt and save it to PAI’s catalog (`data/workflows/`)  
5. **Show badges** in the UI: **API ready** · **Needs check** · **Manual only**

You do **not** need to hand-edit API JSON or write Modelfiles for ComfyUI workflows.

### Quick presets (one-click)

Five built-in presets (z-image, Qwen edit, LTX video, etc.) are synced from PAI `/workflows/presets`. If PAI is offline, the app falls back to the bundled catalog — commands stay the same.

---

## Two catalogs — don’t mix them up

| What | Where | Purpose |
|------|-------|---------|
| **GGUF models** | `catalog/models.json` + CDN | Download Llama, Qwen, etc. for Ollama chat |
| **ComfyUI workflows** | PAI `/workflows/catalog` | Image / video generation pipelines |

Model store updates ≠ workflow list updates. They are separate by design.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Empty workflow list | Check PAI is running; confirm files are in `{PAI}/workflows/`; click **Refresh list** |
| All badges “Manual only” | Start ComfyUI; run **Detect local setup** again |
| Presets missing | Restart `pai serve`; see [`BUTLER_SMOKE.md`](./BUTLER_SMOKE.md) |
| Wrong paths shown | **Settings** → set `paiRoot`; butler → **Detect local setup** |

---

## 中文

### 下载的工作流 JSON 放哪里？

不要把文件放进蘑菇AI安装目录。请放到下面**任一文件夹**，PAI 会自动扫描：

| 目录 | 适用场景 |
|------|----------|
| **`{PAI根目录}/workflows/`**（**推荐**） | 网上下载的 `.json`，例如 `E:\projects\PAI\workflows\` |
| **`{ComfyUI}/ComfyUI/user/default/workflows/`** | 在 ComfyUI 界面里 **Save** 保存的工作流 |

可选：在 PAI 的 `pai.yaml` 里配置 `video_factory.extra_dirs` 增加自定义目录。

**首次使用：** 管家页 **一键识别本机** → 把 `.json` 放进 `{PAI}/workflows/` → **ComfyUI 出片** → **刷新列表**。界面会显示你本机真实路径。

### 会不会自动读取、提取 API 数据？

**会，已实现。** 点击刷新或执行「同步工作流」后，PAI 会：

1. 扫描上述目录  
2. 解析工作流 JSON  
3. 对照 ComfyUI 节点校验  
4. 生成可 API 调用的 prompt 并写入 catalog  
5. 在面板显示 **可 API** / **待校验** / **仅手动** 状态  

无需手改 API JSON。

### 两套目录别搞混

- **GGUF 模型库** → 模型仓库 / `catalog/models.json`（聊天用）  
- **ComfyUI 工作流** → PAI `/workflows/catalog`（出片用）

---

*R&D status (2026-07): Butler team verified 50/50 tests, workflow sync, and API validation on local ComfyUI. Desktop team documents user-facing paths here.*

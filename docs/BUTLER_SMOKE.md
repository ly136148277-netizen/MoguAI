# Butler / ComfyUI smoke checklist（管家 Agent）

> 与 `docs/SMOKE_v1.4.0.md`（桌面安装包）分开。本清单只验 **PAI HTTP + 管家 UI + ComfyUI 出片链路**。

## 前置

| 项 | 期望 |
|----|------|
| PAI 路径 | `E:\projects\PAI`（或设置里 `paiRoot`） |
| PAI HTTP | `http://127.0.0.1:8765`（改代码后需 **重启** `pai serve`） |
| ComfyUI | `http://127.0.0.1:8189`（F 盘实例，PAI yaml 已指向） |
| 桌面应用 | MOGU AI ≥ v1.3（含管家 / ComfyUI 面板） |

## 工作流 JSON 放哪里？

PAI 会扫描 **两个目录**（见 `gateway/video_factory/config.py` → `workflow_search_dirs`）：

| 目录 | 用途 |
|------|------|
| **`{PAI根}/workflows/`** | **推荐**：从网上下载的 `.json` 直接放这里（本机示例 `E:\projects\PAI\workflows\`，当前 **14** 个文件） |
| **`{ComfyUI}/ComfyUI/user/default/workflows/`** | ComfyUI 界面「Save」保存的工作流（本机 `F:\ComfyUI\...\workflows\`） |
| `video_factory.extra_dirs`（可选） | `pai.yaml` 里可再加自定义目录 |

放入后：

1. MOGU AI → **ComfyUI 出片** → **刷新列表**（或管家输入 `同步工作流` / `列出工作流`）
2. PAI 解析 JSON → 对照 ComfyUI `object_info` 校验节点 → 写入 `data/workflows/` catalog + API prompt
3. 面板显示 **可 API** / **待校验** / **仅手动** 徽章

**ComfyUI 程序本身**路径：管家页 **一键识别本机** → 写入 `pai.yaml` 的 `comfyui.path`（与上表工作流目录不同）。

---

## 自动化（本机脚本）

```powershell
cd D:\Project\ai-model-manager
npm test                                    # 含 pai-catalog 五预设同步
node scripts/butler_smoke.js                # 或 .\scripts\butler_smoke.ps1
```

期望：

- [ ] `npm test` → **50/50**
- [ ] `node scripts/butler_smoke.js`（或 `butler_smoke.ps1`）→ `health` / `capabilities` / `workflows/catalog` / `workflows/presets` 均 `ok`
- [ ] `/workflows/presets` 返回 **5** 条，命令与下表一致

### 五预设命令（单一真相源）

| id | workflow | command |
|----|----------|---------|
| `qwen_edit` | `qwen_image_edit` | `确认千问换装` |
| `zimage` | `zimage_gguf` | `确认zimage` |
| `ltx_i2v` | `LTX 2.3_v1.1 i2v` | `确认ltx i2v` |
| `video_ltx` | `video_ltx2_3_i2v` | `确认单镜头` |
| `ace_music` | `audio_ace_step` | `确认ace音乐` |

Python：`E:\projects\PAI\gateway\video_factory\routes.py` → `PRESET_COMMANDS`  
Electron fallback：`src/shared/pai-catalog.js` → `PRESET_COMMANDS`

**勿与 GGUF 模型库混淆**：`catalog/models.json` / `publish_model_catalog.ps1` 属桌面 CDN，见 `docs/RELEASE.md`。

---

## 手动验收（~10 min，可选真实出片）

### 1. 启动链路

1. 打开MOGU AI → **设置** → 确认 PAI 根目录与 API 地址
2. 进入 **AI 执行管家** → 点「连接 PAI」或等待自动 `ensureRunning`
3. 状态应显示：PAI **运行中**、`/health` 正常

### 2. Catalog / Presets

1. 打开 **ComfyUI 工作流** 面板
2. 应列出工作流目录（来自 `GET /workflows/catalog`）；失败时 fallback 不阻塞 UI
3. **快捷预设** 显示 5 条，标签与上表一致
4. 断网或停 PAI 时，预设仍来自 `pai-catalog.js` fallback（命令不变）

### 3. 能力列表

1. 管家页应能拉取 `GET /capabilities`（或通过 IPC `pai:capabilities`）
2. 至少包含：`launch_app`、`video_factory`、`comfyui_manage`、`backup_project`、`delete_path`

### 4. 低风险试跑（不强制完整渲染）

任选其一：

- 管家输入：`doctor` 或 PAI 面板等价检查 → 应返回 ComfyUI 可达性
- 输入 **`确认zimage`**（L1）→ 若 ComfyUI 忙可取消；重点看 **needs_confirm / 队列 / 进度条** 是否正常
- ComfyUI 面板点预设 → 应填入命令并走 `pai:run-tracked`，顶部出现进度 banner

### 5. L2/L3 确认（可选）

- 输入需 L2 的命令（如 `comfyui_manage` 类）→ 应弹确认框，取消不执行
- 输入需 L3 的命令 → 二次确认文案与 `butler-risk.js` 一致

---

## 故障排查

| 现象 | 处理 |
|------|------|
| `/workflows/presets` 404 | 重启 `pai serve`；旧进程无 `6f9d98d` 路由 |
| 预设命令与表不一致 | 对齐 `routes.py` 与 `pai-catalog.js` 的 `PRESET_COMMANDS`，跑 `npm test` |
| PAI 连接拒绝 | 端口 8765 占用；或 venv 路径错误 |
| ComfyUI 无进度 | 检查 `comfyUiPollIntervalMs`；ComfyUI 8189 是否在线 |
| 面板空白 catalog | PAI yaml 工作流目录；API 超时则用 fallback presets |

---

## 不负责（桌面 Agent）

- 安装包冒烟、`updater.js`、`catalog/models.json` CDN
- Ollama 聊天、模型下载、品牌/dist

变更 HTTP 契约或 IPC 前，先在 `MOGU_AI_桌面端存档.md` 留言板登记。

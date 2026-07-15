# Studio v1.5 — 创作台

> 新手主路径：双提示词 + 挂工作流 + 剪映 + 执行。高级列表仍在「ComfyUI 出片」。

## 布局

```
环境状态条：Ollama · PAI · ComfyUI
┌ 人物描述 (+照片) ┬ 动作/行为描述 ┐
│ 模式：文生视频                    │
│  [+] 文生图工作流                 │
│  [+] 图生视频工作流               │
│  工具：[剪映|无]     [执行]       │
└ 进度 / 日志 / 成品路径 ───────────┘
```

## 本地状态

`userData/studio-pipeline.json`：

```json
{
  "character": "",
  "action": "",
  "imagePath": "",
  "t2iWorkflow": "",
  "i2vWorkflow": "",
  "tool": "jianying",
  "mode": "t2v"
}
```

## 执行规则

拼 prompt：`人物：{character}。动作：{action}`

| 挂载 | 行为 |
|------|------|
| T2I + I2V | 先跑文生图 → 输出图作 I2V 输入 → 视频 |
| 仅 I2V + 照片 | 照片进 ComfyUI input → I2V |
| 仅 T2I | 出图 |
| 仅视频类（挂在 I2V 槽） | 直接出片 |
| 工作流不可 API | 禁止执行并提示 |

## 后端

- PAI `POST /studio/run`（body：character/action/image/t2i_workflow/i2v_workflow/open_jianying/level）
- 内部调用 `video_factory.run`（confirm + override prompt/image）
- 成功后可选 `video_edit.open_jianying` / Electron `shell.openPath(成品目录)`

桌面：`pai-bridge.runStudio` + IPC `pai:studio-run`；UI 走 L2 确认后 `run-tracked` 风格进度（`pai-run-progress` 或 studio 专用事件）。

## 工作流挂载

- `+` 弹层：过滤 catalog `kind=image` / `kind=video`
- 「从文件添加」：复制 `.json` → `{paiRoot}/workflows/` → 同步 catalog

## 与旧页关系

| 页 | 用途 |
|----|------|
| 创作台 | 新手流水线 |
| ComfyUI 出片 | 全部工作流 / 预设高级入口 |
| 指令控制台 | 自然语言管家 |

## 归属

- Studio UI / 编排：管家 Agent（`studio-panel.js`）
- Setup Hub：桌面侧模块，可同仓实现
- `POST /studio/run`：PAI 仓

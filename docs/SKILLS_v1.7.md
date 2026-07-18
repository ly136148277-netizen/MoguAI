# MOGU Skills v1.7

每个 `mogu.*` 必须四件套：`SKILL.md` + 主进程 handler + PermissionProxy + TaskStore 契约。

| Skill | 默认风险 | 主要操作 | 任务 source | 环境灯 |
|-------|----------|----------|-------------|--------|
| `mogu.comfy` | L2 | list / run / status / cancel | comfy | PAI + ComfyUI |
| `mogu.studio` | L2 | preflight / run / retry | studio | PAI + ComfyUI |
| `mogu.ollama` | L1–L2 | list / status / import | pai | Ollama |
| `mogu.pc` | L1–L3 | open / search / backup / run | pai | PAI |
| `mogu.media` | L2 | preflight / ensure / concat | pai | FFmpeg |

## IPC

- `skills:list` / `skills:set-enabled` / `skills:doc`
- `skills:preflight` / `skills:invoke` / `skills:sync-openclaw-docs`

## 执行边界

- 执行永远在 MOGU 主进程 `SkillRuntime`。
- `skills:sync-openclaw-docs` 仅复制说明到 `~/.openclaw/skills/`，不把 Runtime 交给 Gateway。
- 取消 Comfy 任务必须带 `promptId`。

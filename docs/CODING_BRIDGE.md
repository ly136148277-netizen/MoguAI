# 编程双引擎桥接（Codex CLI + trae-agent）

MOGU 不内嵌 Trae 完整 IDE，也不重写 Codex。通过 Skill **`mogu.coding`** 把两个开源 CLI 接到对话 / 任务中心 / 权限中心。

## 引擎位置（本机旁路，不进安装包）

| 引擎 | 仓库 | 许可 |
|------|------|------|
| Codex CLI | `D:\Project\vendor\openai-codex`（[openai/codex](https://github.com/openai/codex)） | Apache-2.0 |
| trae-agent | `D:\Project\vendor\trae-agent`（[bytedance/trae-agent](https://github.com/bytedance/trae-agent)） | MIT |

完整 Trae CN IDE **未开源**，只接 `trae-agent` CLI。

## 安装引擎

### Codex

```powershell
npm i -g @openai/codex
# 或依赖 npx（MOGU 会自动尝试）
npx @openai/codex --version
```

### trae-agent

```powershell
cd D:\Project\vendor\trae-agent
uv sync
uv run trae-cli --help
```

配置 API：复制 `trae_config.yaml.example` → `trae_config.yaml`（勿提交密钥）。

## 架构：大脑 + 工具

- **大脑**：设置里选「联网 API」或「本机 Ollama」，对话指令由模型决定调用哪些 Skill。  
- **工具**：本机 / Comfy / 创作 / 编程（Codex、trae-agent）等，由大脑自动调度。  
- **密钥只填一次**（大脑），启动编程引擎时自动注入；计费按供应商调用，不是双倍订阅。

## 在 MOGU 里用（推荐）

1. **设置 → 大脑通道** = 联网 API，填 Key / 模型  
2. **设置 → 编程工具**：填默认工作区（不必再填 Key）  
3. **对话直接下指令**，例如：「把 D:\\proj 里登录 bug 修一下」「打开 ComfyUI」「列工作流」  
4. 仍可用精确句：`编程状态`、`编程: …`  
5. 失败可换引擎重试；任务中心来源 `编程` 

## 权限与任务

- `run` / `retry`：默认 L2，走 PermissionProxy  
- 子进程日志写入任务 `logSummary`，可取消  

## 验收

```powershell
node scripts/acceptance_coding_bridge.js
```

## 差异化（防空壳）

1. 统一对话入口  
2. 双引擎可切换 / 换引擎重试  
3. 任务中心 + 权限中心  
4. 工作区与密钥在 userData / 引擎自有配置，不进安装包  

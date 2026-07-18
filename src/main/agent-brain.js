/**
 * MOGU 「大脑」：API / 本地模型负责理解与调度；Skills 等为工具。
 */

const AGENT_SYSTEM_PROMPT = `你是 MOGU AI 的大脑（编排器），用简洁中文沟通。

你的角色：只负责理解用户意图，并调用工具完成任务。不要假装已经操作了电脑。

可用工具（必须通过 function call 调用，不要只口述命令让用户自己去点）：
- mogu_pc：打开应用、搜索文件、备份 PAI、执行本机命令
- mogu_comfy：列出/运行 ComfyUI 工作流
- mogu_studio：创作台出片预检/运行
- mogu_ollama：本机模型列表/状态
- mogu_media：视频合成预检
- mogu_coding：编程（Codex / trae-agent），需要 workspace 与 prompt

规则：
1. 用户要办事/改代码/出片 → 立刻调用对应工具。
2. 纯问答/用法 → 直接用自然语言回答，不调用工具。
3. 删除等危险操作仍由工具侧权限中心二次确认。
4. 编程任务：若用户未给路径，用设置中的默认工作区参数（可省略 workspace 让工具用默认值）。
5. 一次可以串行多轮工具；每步根据工具结果决定下一步或最终回复。`;

const API_PRESETS = {
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  qwen: {
    label: "通义千问（兼容模式）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  moonshot: {
    label: "月之暗面 Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
  },
  custom: {
    label: "自定义 OpenAI 兼容",
    baseUrl: "",
    model: "",
  },
};

const BRAIN_TOOLS = [
  {
    type: "function",
    function: {
      name: "mogu_pc",
      description: "本机助手：打开应用、搜索、备份、执行命令",
      parameters: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["open", "search", "backup", "run"] },
          command: { type: "string", description: "完整中文命令，如 打开 ComfyUI" },
          app: { type: "string" },
          query: { type: "string" },
        },
        required: ["op"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mogu_comfy",
      description: "ComfyUI 工作流列表或出片命令",
      parameters: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["list", "run", "status", "preflight"] },
          command: { type: "string" },
        },
        required: ["op"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mogu_studio",
      description: "创作台出片预检或运行",
      parameters: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["preflight", "run", "retry"] },
        },
        required: ["op"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mogu_ollama",
      description: "Ollama 模型状态或列表",
      parameters: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["status", "list", "preflight"] },
        },
        required: ["op"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mogu_media",
      description: "视频合成预检",
      parameters: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["preflight", "ensure", "concat"] },
        },
        required: ["op"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mogu_coding",
      description: "编程双引擎：探测状态或在工作区改代码",
      parameters: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["status", "run", "cancel", "retry"] },
          engine: { type: "string", enum: ["codex", "trae"] },
          workspace: { type: "string", description: "本地仓库路径，可省略用默认工作区" },
          prompt: { type: "string", description: "编程任务说明" },
          model: { type: "string" },
        },
        required: ["op"],
      },
    },
  },
];

const TOOL_TO_SKILL = {
  mogu_pc: "mogu.pc",
  mogu_comfy: "mogu.comfy",
  mogu_studio: "mogu.studio",
  mogu_ollama: "mogu.ollama",
  mogu_media: "mogu.media",
  mogu_coding: "mogu.coding",
};

function normalizeBaseUrl(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}

function mapToolNameToSkill(name) {
  return TOOL_TO_SKILL[String(name || "").trim()] || null;
}

async function chatOpenAiCompatible({
  baseUrl,
  apiKey,
  model,
  messages,
  tools = null,
  timeoutMs = 90000,
}) {
  const root = normalizeBaseUrl(baseUrl);
  if (!root) throw new Error("请填写 API Base URL");
  if (!model) throw new Error("请填写模型名");
  if (!apiKey) throw new Error("请填写 API Key");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      model,
      messages,
      temperature: 0.3,
    };
    if (Array.isArray(tools) && tools.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const response = await fetch(`${root}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text || `API 返回非 JSON（${response.status}）`);
    }

    if (!response.ok) {
      const errMsg = payload.error?.message || payload.message || text || `HTTP ${response.status}`;
      throw new Error(errMsg);
    }

    const message = payload.choices?.[0]?.message || {};
    const content = message.content != null ? String(message.content).trim() : "";
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    return {
      ok: true,
      content,
      toolCalls,
      message,
      provider: "api",
      model,
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("API 请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function scrubToolResult(result) {
  if (!result || typeof result !== "object") return { ok: false };
  const out = { ...result };
  delete out.log;
  if (out.log) delete out.log;
  const json = JSON.stringify(out);
  return json.length > 6000 ? `${json.slice(0, 6000)}…` : json;
}

async function invokeMappedTool(skillRuntime, toolName, args = {}, channel = "brain") {
  const skillId = mapToolNameToSkill(toolName);
  if (!skillId) {
    return { ok: false, error: `未知工具：${toolName}` };
  }
  if (!skillRuntime?.invoke) {
    return { ok: false, error: "SkillRuntime 不可用" };
  }
  const op = String(args.op || "run").trim();
  const { op: _ignore, ...rest } = args;
  return skillRuntime.invoke(skillId, op, rest, { channel });
}

/**
 * Brain loop: model may call tools; MOGU executes Skills then continues.
 */
async function runBrainAgent({
  settings,
  ollama,
  skillRuntime,
  userText,
  history = [],
  maxRounds = 4,
  onProgress = null,
} = {}) {
  const channel = settings.agentBrainChannel || "builtin";
  const text = String(userText || "").trim();
  if (!text) return { ok: false, error: "空指令" };

  if (channel === "builtin") {
    return { ok: true, content: null, provider: "builtin", steps: [], mode: "passthrough" };
  }

  const steps = [];
  const messages = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-8)
      .map((m) => ({ role: m.role, content: String(m.content || "") })),
    { role: "user", content: text },
  ];

  if (channel === "local") {
    return runLocalBrainJson({
      settings,
      ollama,
      skillRuntime,
      messages,
      steps,
      maxRounds,
      onProgress,
    });
  }

  if (channel !== "api") {
    throw new Error(`未知 Agent 通道：${channel}`);
  }

  for (let round = 0; round < maxRounds; round += 1) {
    onProgress?.({ phase: "thinking", round });
    const reply = await chatOpenAiCompatible({
      baseUrl: settings.agentApiBaseUrl,
      apiKey: settings.agentApiKey,
      model: settings.agentApiModel,
      messages,
      tools: BRAIN_TOOLS,
    });

    if (!reply.toolCalls.length) {
      return {
        ok: true,
        content: reply.content || "（无回复）",
        provider: "api",
        model: reply.model,
        steps,
        mode: "brain",
      };
    }

    messages.push({
      role: "assistant",
      content: reply.content || null,
      tool_calls: reply.toolCalls,
    });

    for (const call of reply.toolCalls) {
      const name = call.function?.name || call.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || call.arguments || "{}");
      } catch {
        args = {};
      }
      onProgress?.({ phase: "tool", tool: name, args, round });
      const result = await invokeMappedTool(skillRuntime, name, args, "brain");
      steps.push({
        tool: name,
        skillId: mapToolNameToSkill(name),
        op: args.op || "run",
        ok: result?.ok !== false,
        moguTaskId: result?.moguTaskId || null,
        error: result?.error || null,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id || `call_${round}_${name}`,
        content: scrubToolResult(result),
      });
    }
  }

  return {
    ok: true,
    content: steps.length
      ? `已执行 ${steps.length} 步工具。${steps.map((s) => `${s.tool}.${s.op}:${s.ok ? "ok" : "fail"}`).join("；")}`
      : "已达最大工具轮次。",
    provider: "api",
    model: settings.agentApiModel,
    steps,
    mode: "brain",
    truncated: true,
  };
}

async function runLocalBrainJson({
  settings,
  ollama,
  skillRuntime,
  messages,
  steps,
  maxRounds,
  onProgress,
}) {
  const modelName = String(settings.agentLocalModel || "").trim();
  if (!modelName) throw new Error("请先在设置里选择本地 Ollama 模型");
  if (!ollama) throw new Error("Ollama 服务不可用");

  const plannerExtra = {
    role: "system",
    content:
      '若需调用工具，只输出一行 JSON：{"tool":"mogu_coding","op":"run","args":{...}}；若只需回答：{"reply":"..."}。不要输出其它文字。',
  };

  for (let round = 0; round < maxRounds; round += 1) {
    onProgress?.({ phase: "thinking", round });
    const result = await ollama.chat(
      modelName,
      [...messages.slice(0, 1), plannerExtra, ...messages.slice(1)],
      null,
      { chatId: `agent-brain-${Date.now()}` }
    );
    const content = String(result.message?.content || "").trim();
    const parsed = extractJsonObject(content);
    if (!parsed) {
      return { ok: true, content, provider: "local", model: modelName, steps, mode: "brain" };
    }
    if (parsed.reply && !parsed.tool) {
      return {
        ok: true,
        content: String(parsed.reply),
        provider: "local",
        model: modelName,
        steps,
        mode: "brain",
      };
    }
    if (!parsed.tool) {
      return { ok: true, content, provider: "local", model: modelName, steps, mode: "brain" };
    }
    const args = { ...(parsed.args || {}), op: parsed.op || parsed.args?.op || "run" };
    onProgress?.({ phase: "tool", tool: parsed.tool, args, round });
    const toolResult = await invokeMappedTool(skillRuntime, parsed.tool, args, "brain");
    steps.push({
      tool: parsed.tool,
      skillId: mapToolNameToSkill(parsed.tool),
      op: args.op,
      ok: toolResult?.ok !== false,
      moguTaskId: toolResult?.moguTaskId || null,
      error: toolResult?.error || null,
    });
    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content: `工具 ${parsed.tool} 结果：${scrubToolResult(toolResult)}\n若已完成请输出 {"reply":"..."}，否则继续输出工具 JSON。`,
    });
  }

  return {
    ok: true,
    content: `已执行工具：${steps.map((s) => s.tool).join(", ")}`,
    provider: "local",
    model: modelName,
    steps,
    mode: "brain",
    truncated: true,
  };
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function chatWithBrain({ settings, ollama, userText, history = [] }) {
  const channel = settings.agentBrainChannel || "builtin";
  if (channel === "builtin") {
    return { ok: true, content: null, provider: "builtin" };
  }

  const messages = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userText },
  ];

  if (channel === "local") {
    const modelName = String(settings.agentLocalModel || "").trim();
    if (!modelName) throw new Error("请先在设置里选择本地 Ollama 模型");
    if (!ollama) throw new Error("Ollama 服务不可用");
    const result = await ollama.chat(modelName, messages, null, { chatId: `agent-${Date.now()}` });
    const content = result.message?.content || "";
    if (!content.trim()) throw new Error("本地模型未返回内容");
    return { ok: true, content: content.trim(), provider: "local", model: modelName };
  }

  if (channel === "api") {
    return chatOpenAiCompatible({
      baseUrl: settings.agentApiBaseUrl,
      apiKey: settings.agentApiKey,
      model: settings.agentApiModel,
      messages,
    });
  }

  throw new Error(`未知 Agent 通道：${channel}`);
}

async function testBrain({ settings, ollama }) {
  const channel = settings.agentBrainChannel || "builtin";
  if (channel === "builtin") {
    return { ok: true, message: "内置引导：未启用大脑调度。请在设置把引导改为「联网 API」或「本机模型」。" };
  }
  const result = await chatWithBrain({
    settings,
    ollama,
    userText: "用一句话介绍你是 MOGU 的大脑编排器，并举例一个你会调用的工具名。",
    history: [],
  });
  return {
    ok: true,
    message: `连通成功（${result.provider}${result.model ? ` · ${result.model}` : ""}）`,
    sample: result.content?.slice(0, 200) || "",
  };
}

module.exports = {
  AGENT_SYSTEM_PROMPT,
  API_PRESETS,
  BRAIN_TOOLS,
  TOOL_TO_SKILL,
  chatWithBrain,
  chatOpenAiCompatible,
  runBrainAgent,
  mapToolNameToSkill,
  invokeMappedTool,
  testBrain,
  normalizeBaseUrl,
  extractJsonObject,
};

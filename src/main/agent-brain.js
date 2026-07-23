/**
 * MOGU 「大脑」：API / 本地模型负责理解与调度；Skills / MCP 等为工具。
 */

const {
  SKILL_META,
  buildBrainToolsFromRegistry,
  skillIdToToolName,
  toolNameToSkillId,
} = require("./skills/registry");
const { mcpManager } = require("./mcp-client");

const AGENT_SYSTEM_PROMPT = `你是 MOGU AI 的大脑（编排器），用简洁中文沟通。

你的角色：只负责理解用户意图，并调用工具完成任务。不要假装已经操作了电脑。

可用工具（必须通过 function call 调用，不要只口述命令让用户自己去点）：
- mogu_pc：打开应用、搜索文件、备份 PAI、执行本机命令
- mogu_comfy：列出/运行/取消 ComfyUI 工作流
- mogu_studio：创作台出片预检/运行/重试
- mogu_ollama：本机模型列表/状态/导入
- mogu_media：视频合成预检/拼接
- mogu_coding：MOGU AI 编程（引擎 A/B 可切换）；改完可用 review 看文件/diff，commit 需用户确认后调用，verify 跑测试
- mogu_search：联网搜索实时事实
- mogu_browser：打开网页、抓取正文；复杂办事用 act/click/fill（需本机 Playwright）
- mogu_memory：分层记忆 preference/project/session；记住/回忆
- mcp__*：设置里配置的 MCP 服务器工具（若有）

规则：
1. 用户要办事/改代码/出片/查网/记事 → 立刻调用对应工具。
2. 纯问答/用法 → 直接用自然语言回答，不调用工具。
3. 删除等危险操作仍由工具侧权限中心二次确认；git commit 必须先说明改动再调 commit。
4. 编程任务：若用户未给路径，用设置中的默认工作区参数（可省略 workspace 让工具用默认值）。
5. 一次可以串行多轮工具；每步根据工具结果决定下一步或最终回复。
6. 系统会注入并自动沉淀高价值记忆；用户说「记住…」务必调用 mogu_memory.remember。
7. 网页填表/点击：用 mogu_browser.act 传 steps，或 click/fill；不要假装已操作。`;

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

/** Built from registry so ops stay aligned with SkillRuntime. */
const BRAIN_TOOLS = buildBrainToolsFromRegistry();

const TOOL_TO_SKILL = Object.fromEntries(
  Object.keys(SKILL_META).map((id) => [skillIdToToolName(id), id])
);

function normalizeBaseUrl(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}

function mapToolNameToSkill(name) {
  const n = String(name || "").trim();
  if (n.startsWith("mcp__")) return null;
  return TOOL_TO_SKILL[n] || toolNameToSkillId(n);
}

async function loadMemoryPreamble(skillRuntime, userText) {
  if (!skillRuntime?.invoke) return { text: "", facts: [] };
  try {
    const result = await skillRuntime.invoke(
      "mogu.memory",
      "recall",
      { query: String(userText || "").slice(0, 240), limit: 6 },
      { skipPermission: true, skipTask: true, channel: "brain" }
    );
    const facts = Array.isArray(result?.facts) ? result.facts : [];
    if (!facts.length) return { text: "", facts: [] };
    const lines = facts.map((f) => `- [${f.layer || "project"}] ${f.key}: ${f.value}`);
    return { text: `【跨会话记忆】\n${lines.join("\n")}`, facts };
  } catch {
    return { text: "", facts: [] };
  }
}

async function autoPersistMemory(skillRuntime, userText, steps, settings) {
  if (!skillRuntime?.invoke) return [];
  let extractHighValueFacts;
  try {
    ({ extractHighValueFacts } = require("./skills/handlers/memory"));
  } catch {
    return [];
  }
  const candidates = extractHighValueFacts(userText, steps, settings || {});
  const saved = [];
  for (const fact of candidates) {
    try {
      const result = await skillRuntime.invoke("mogu.memory", "remember", fact, {
        skipPermission: true,
        skipTask: true,
        channel: "brain",
      });
      if (result?.ok !== false) saved.push(fact);
    } catch {
      /* ignore single write failure */
    }
  }
  return saved;
}

/**
 * Keep recent turns; compress older ones into a short digest for longer context.
 */
function buildHistoryForBrain(history = [], { keepRecent = 6, maxDigestChars = 1500 } = {}) {
  const msgs = (Array.isArray(history) ? history : [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: String(m.content || "") }));
  if (msgs.length <= keepRecent + 2) {
    return { messages: msgs.slice(-(keepRecent + 2)), compressed: false };
  }
  const older = msgs.slice(0, -keepRecent);
  const recent = msgs.slice(-keepRecent);
  const digest = older
    .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content.replace(/\s+/g, " ").slice(0, 140)}`)
    .join("\n")
    .slice(0, maxDigestChars);
  return {
    messages: [
      { role: "user", content: `（更早对话摘要，供上下文）\n${digest}` },
      { role: "assistant", content: "已了解此前上下文，继续。" },
      ...recent,
    ],
    compressed: true,
  };
}

function buildSystemPrompt(memoryText = "") {
  if (!memoryText) return AGENT_SYSTEM_PROMPT;
  return `${AGENT_SYSTEM_PROMPT}\n\n${memoryText}`;
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

function codingStepFields(result = {}) {
  return {
    review: result.review || null,
    suggestedCommitMessage: result.suggestedCommitMessage || null,
    canCommit: result.canCommit === true,
    workspace: result.workspace || null,
    engine: result.engine || null,
    canInstallRuntime: Boolean(result.canInstallRuntime),
    upgradeEngine: result.upgradeEngine || null,
    ctaMessage: result.ctaMessage || null,
    code: result.code || null,
  };
}

/** Append coding review summary so chat/task stream see work results. */
function buildBrainContent(steps = [], fallback = "") {
  const base = steps.length
    ? `已执行 ${steps.length} 步工具。${steps.map((s) => `${s.tool}.${s.op}:${s.ok ? "ok" : "fail"}`).join("；")}`
    : fallback || "（无步骤）";
  const coding = [...steps]
    .reverse()
    .find((s) => s?.review?.summary || (s?.tool === "mogu_coding" && s?.review));
  if (!coding?.review) return base;
  const summary = String(coding.review.summary || "").trim();
  const n = coding.review.fileCount || coding.review.files?.length || 0;
  const bits = [base];
  if (summary) bits.push(summary);
  if (n) bits.push(`改动文件 ${n} 个`);
  if (coding.canCommit) bits.push("可在任务卡确认提交，或打开精密工厂继续改。");
  return bits.join("\n");
}

async function resolveBrainTools(settings) {
  const base = BRAIN_TOOLS.map((t) => ({
    type: t.type,
    function: t.function,
  }));
  if (!settings?.mcpServers?.length) return base;
  try {
    const { tools } = await mcpManager.listAllTools(settings);
    return base.concat(
      tools.map((t) => ({
        type: t.type,
        function: t.function,
      }))
    );
  } catch {
    return base;
  }
}

async function invokeMappedTool(skillRuntime, toolName, args = {}, channel = "brain", settings = null) {
  const name = String(toolName || "").trim();
  if (name.startsWith("mcp__")) {
    return mcpManager.call(settings || {}, name, args);
  }
  const skillId = mapToolNameToSkill(name);
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
  onProgress?.({ phase: "memory", executor: "brain" });
  const memory = await loadMemoryPreamble(skillRuntime, text);
  const hist = buildHistoryForBrain(history);
  const messages = [
    { role: "system", content: buildSystemPrompt(memory.text) },
    ...hist.messages,
    { role: "user", content: text },
  ];
  if (memory.facts?.length) {
    steps.push({
      tool: "mogu_memory",
      skillId: "mogu.memory",
      op: "recall",
      ok: true,
      moguTaskId: null,
      error: null,
      meta: { factCount: memory.facts.length },
    });
    onProgress?.({
      phase: "tool",
      tool: "mogu_memory",
      args: { op: "recall" },
      round: 0,
      executor: "brain",
      steps,
    });
  }

  if (channel === "local") {
    return runLocalBrainJson({
      settings,
      ollama,
      skillRuntime,
      messages,
      steps,
      maxRounds,
      onProgress,
      memoryCompressed: hist.compressed,
      userText: text,
    });
  }

  if (channel !== "api") {
    throw new Error(`未知 Agent 通道：${channel}`);
  }

  const tools = await resolveBrainTools(settings);

  for (let round = 0; round < maxRounds; round += 1) {
    onProgress?.({ phase: "thinking", round, executor: "brain" });
    const reply = await chatOpenAiCompatible({
      baseUrl: settings.agentApiBaseUrl,
      apiKey: settings.agentApiKey,
      model: settings.agentApiModel,
      messages,
      tools,
    });

    if (!reply.toolCalls.length) {
      const remembered = await autoPersistMemory(skillRuntime, text, steps, settings);
      const replyText = reply.content || "（无回复）";
      const withReview = steps.some((s) => s?.review?.summary)
        ? `${replyText}\n${buildBrainContent(steps, "").split("\n").slice(1).join("\n")}`.trim()
        : replyText;
      return {
        ok: true,
        content: withReview,
        provider: "api",
        model: reply.model,
        steps,
        mode: "brain",
        executor: "brain",
        historyCompressed: hist.compressed,
        memoryFacts: memory.facts?.length || 0,
        remembered: remembered.length,
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
      onProgress?.({ phase: "tool", tool: name, args, round, executor: "brain", steps });
      const result = await invokeMappedTool(skillRuntime, name, args, "brain", settings);
      const step = {
        tool: name,
        skillId: mapToolNameToSkill(name),
        op: args.op || (String(name).startsWith("mcp__") ? "call" : "run"),
        ok: result?.ok !== false,
        moguTaskId: result?.moguTaskId || null,
        error: result?.error || null,
        ...codingStepFields(result),
      };
      steps.push(step);
      onProgress?.({ phase: "tool_done", tool: name, step, steps, round, executor: "brain" });
      messages.push({
        role: "tool",
        tool_call_id: call.id || `call_${round}_${name}`,
        content: scrubToolResult(result),
      });
    }
  }

  const remembered = await autoPersistMemory(skillRuntime, text, steps, settings);
  return {
    ok: true,
    content: buildBrainContent(steps, "已达最大工具轮次。"),
    provider: "api",
    model: settings.agentApiModel,
    steps,
    mode: "brain",
    executor: "brain",
    truncated: true,
    historyCompressed: hist.compressed,
    memoryFacts: memory.facts?.length || 0,
    remembered: remembered.length,
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
  memoryCompressed = false,
  userText = "",
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
    onProgress?.({ phase: "thinking", round, executor: "brain" });
    const result = await ollama.chat(
      modelName,
      [...messages.slice(0, 1), plannerExtra, ...messages.slice(1)],
      null,
      { chatId: `agent-brain-${Date.now()}` }
    );
    const content = String(result.message?.content || "").trim();
    const parsed = extractJsonObject(content);
    if (!parsed) {
      const remembered = await autoPersistMemory(skillRuntime, userText, steps, settings);
      return {
        ok: true,
        content,
        provider: "local",
        model: modelName,
        steps,
        mode: "brain",
        executor: "brain",
        historyCompressed: memoryCompressed,
        remembered: remembered.length,
      };
    }
    if (parsed.reply && !parsed.tool) {
      const remembered = await autoPersistMemory(skillRuntime, userText, steps, settings);
      return {
        ok: true,
        content: String(parsed.reply),
        provider: "local",
        model: modelName,
        steps,
        mode: "brain",
        executor: "brain",
        historyCompressed: memoryCompressed,
        remembered: remembered.length,
      };
    }
    if (!parsed.tool) {
      const remembered = await autoPersistMemory(skillRuntime, userText, steps, settings);
      return {
        ok: true,
        content,
        provider: "local",
        model: modelName,
        steps,
        mode: "brain",
        executor: "brain",
        historyCompressed: memoryCompressed,
        remembered: remembered.length,
      };
    }
    const args = { ...(parsed.args || {}), op: parsed.op || parsed.args?.op || "run" };
    onProgress?.({ phase: "tool", tool: parsed.tool, args, round, executor: "brain", steps });
    const toolResult = await invokeMappedTool(skillRuntime, parsed.tool, args, "brain", settings);
    const step = {
      tool: parsed.tool,
      skillId: mapToolNameToSkill(parsed.tool),
      op: args.op,
      ok: toolResult?.ok !== false,
      moguTaskId: toolResult?.moguTaskId || null,
      error: toolResult?.error || null,
      ...codingStepFields(toolResult),
    };
    steps.push(step);
    onProgress?.({ phase: "tool_done", tool: parsed.tool, step, steps, round, executor: "brain" });
    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content: `工具 ${parsed.tool} 结果：${scrubToolResult(toolResult)}\n若已完成请输出 {"reply":"..."}，否则继续输出工具 JSON。`,
    });
  }

  return {
    ok: true,
    content: buildBrainContent(steps, `已执行工具：${steps.map((s) => s.tool).join(", ")}`),
    provider: "local",
    model: modelName,
    steps,
    mode: "brain",
    executor: "brain",
    truncated: true,
    historyCompressed: memoryCompressed,
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
  buildBrainContent,
  chatWithBrain,
  chatOpenAiCompatible,
  runBrainAgent,
  mapToolNameToSkill,
  invokeMappedTool,
  resolveBrainTools,
  loadMemoryPreamble,
  autoPersistMemory,
  buildHistoryForBrain,
  buildSystemPrompt,
  testBrain,
  normalizeBaseUrl,
  extractJsonObject,
};

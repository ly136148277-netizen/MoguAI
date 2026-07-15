/**
 * Agent 「脑子」：本地 Ollama 或 OpenAI 兼容 API。
 * 只负责引导/答疑；开软件、删文件等仍由 PAI 执行。
 */

const AGENT_SYSTEM_PROMPT = `你是 MOGU AI 桌面应用的 Agent 助手，用简洁中文回答。

应用能力：
- 办事（本机 PAI 执行）：打开 ComfyUI、列出工作流、搜索文件、备份 PAI、打开/删除文件等。危险操作会二次确认。
- 创作：侧栏「创作」挂文生图/图生视频工作流后出片。
- 模型：侧栏「模型」下载 GGUF 并导入 Ollama。
- 环境：侧栏「环境」安装/检测 Ollama、PAI、ComfyUI。

规则：
1. 用户若要办事，给出可直接发送的中文指令（如「打开 ComfyUI」「搜索 桌面」），并说明会由执行引擎处理。
2. 不要假装已经操作了电脑或已经出片。
3. 删除文件必须提醒确认，并要求写清完整路径。
4. 用法类问题给出分步指引。`;

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

function normalizeBaseUrl(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}

async function chatOpenAiCompatible({ baseUrl, apiKey, model, messages, timeoutMs = 90000 }) {
  const root = normalizeBaseUrl(baseUrl);
  if (!root) {
    throw new Error("请填写 API Base URL");
  }
  if (!model) {
    throw new Error("请填写模型名");
  }
  if (!apiKey) {
    throw new Error("请填写 API Key");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${root}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
      }),
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

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("API 未返回内容");
    }
    return {
      ok: true,
      content: String(content).trim(),
      provider: "api",
      model,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("API 请求超时");
    }
    throw error;
  } finally {
    clearTimeout(timer);
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
    if (!modelName) {
      throw new Error("请先在设置里选择本地 Ollama 模型");
    }
    if (!ollama) {
      throw new Error("Ollama 服务不可用");
    }
    const result = await ollama.chat(modelName, messages, null, { chatId: `agent-${Date.now()}` });
    const content = result.message?.content || "";
    if (!content.trim()) {
      throw new Error("本地模型未返回内容");
    }
    return {
      ok: true,
      content: content.trim(),
      provider: "local",
      model: modelName,
    };
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
    return { ok: true, message: "内置引导：无需联网，答用法用本地教程" };
  }
  const result = await chatWithBrain({
    settings,
    ollama,
    userText: "用一句话介绍你自己，并举例一条可执行指令。",
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
  chatWithBrain,
  chatOpenAiCompatible,
  testBrain,
  normalizeBaseUrl,
};

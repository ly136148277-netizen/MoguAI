const crypto = require("crypto");
const net = require("net");

const DEFAULT_LIMITS = Object.freeze({
  timeoutMs: 90000,
  maxRequestBytes: 2 * 1024 * 1024,
  maxResponseBytes: 4 * 1024 * 1024,
  maxToolArgumentsBytes: 64 * 1024,
  maxOutputTokens: 4096,
  maxSteps: 4,
});

const ERROR_CODES = Object.freeze({
  BLOCKED: "BLOCKED",
  MODEL_MISMATCH: "MODEL_MISMATCH",
  INVALID_CONFIG: "INVALID_CONFIG",
  REQUEST_TOO_LARGE: "REQUEST_TOO_LARGE",
  RESPONSE_TOO_LARGE: "RESPONSE_TOO_LARGE",
  TOOL_ARGUMENTS_TOO_LARGE: "TOOL_ARGUMENTS_TOO_LARGE",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  HTTP_ERROR: "HTTP_ERROR",
  TIMEOUT: "TIMEOUT",
  ABORTED: "ABORTED",
});

class BrainAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BrainAdapterError";
    this.code = code;
    this.status = [ERROR_CODES.BLOCKED, ERROR_CODES.MODEL_MISMATCH].includes(code) ? "BLOCKED" : "ERROR";
    this.retryable = Boolean(details.retryable);
    this.httpStatus = details.httpStatus || null;
    this.provider = details.provider || null;
    this.modelId = details.modelId || null;
    this.requestId = details.requestId || null;
    this.latencyMs = details.latencyMs ?? null;
    this.configHash = details.configHash || null;
    this.cause = details.cause;
  }

  toResult() {
    return {
      ok: false,
      status: this.status,
      code: this.code,
      error: this.message,
      retryable: this.retryable,
      httpStatus: this.httpStatus,
      provider: this.provider,
      modelId: this.modelId,
      requestId: this.requestId,
      latencyMs: this.latencyMs,
      configHash: this.configHash,
    };
  }
}

function byteLength(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function isPrivateHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const octets = host.split(".").map(Number);
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      octets[0] === 0
    );
  }
  if (ipVersion === 6) {
    return host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  }
  return false;
}

function validateEndpoint(endpoint, { allowPrivateNetwork = false, allowInsecureLocalhost = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(endpoint || "").trim());
  } catch {
    throw new BrainAdapterError(ERROR_CODES.BLOCKED, "Brain adapter endpoint is missing or invalid");
  }
  if (parsed.username || parsed.password) {
    throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, "Brain adapter endpoint must not contain credentials");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, "Brain adapter endpoint must use HTTPS");
  }
  const privateHost = isPrivateHostname(parsed.hostname);
  if (parsed.protocol === "http:" && !(allowInsecureLocalhost && privateHost)) {
    throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, "Brain adapter endpoint must use HTTPS");
  }
  if (privateHost && !allowPrivateNetwork && !allowInsecureLocalhost) {
    throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, "Private-network brain adapter endpoints require explicit opt-in");
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
}

function resolveCompletionUrl(endpoint) {
  return /\/chat\/completions$/i.test(new URL(endpoint).pathname)
    ? endpoint
    : `${endpoint}/chat/completions`;
}

function boundedInteger(value, fallback, min, max, label) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, `${label} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function normalizeConfig(input = {}) {
  for (const forbidden of ["apiKey", "key", "token", "authorization", "headers"]) {
    if (Object.prototype.hasOwnProperty.call(input, forbidden)) {
      throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, `${forbidden} is not allowed in persisted adapter configuration`);
    }
  }
  const provider = String(input.provider || "").trim();
  const modelId = String(input.modelId || input.model || "").trim();
  if (!provider) throw new BrainAdapterError(ERROR_CODES.BLOCKED, "Brain adapter provider is not configured");
  if (!modelId) throw new BrainAdapterError(ERROR_CODES.BLOCKED, "Brain adapter exact model ID is not configured");

  const limits = input.limits || {};
  const timeoutMs = boundedInteger(
    input.timeoutMs ?? limits.timeoutMs,
    DEFAULT_LIMITS.timeoutMs,
    100,
    10 * 60 * 1000,
    "timeoutMs"
  );
  const normalizedLimits = {
    timeoutMs,
    maxRequestBytes: boundedInteger(
      limits.maxRequestBytes,
      DEFAULT_LIMITS.maxRequestBytes,
      1024,
      16 * 1024 * 1024,
      "maxRequestBytes"
    ),
    maxResponseBytes: boundedInteger(
      limits.maxResponseBytes,
      DEFAULT_LIMITS.maxResponseBytes,
      1024,
      32 * 1024 * 1024,
      "maxResponseBytes"
    ),
    maxToolArgumentsBytes: boundedInteger(
      limits.maxToolArgumentsBytes,
      DEFAULT_LIMITS.maxToolArgumentsBytes,
      128,
      1024 * 1024,
      "maxToolArgumentsBytes"
    ),
    maxOutputTokens: boundedInteger(
      limits.maxOutputTokens,
      DEFAULT_LIMITS.maxOutputTokens,
      1,
      1000000,
      "maxOutputTokens"
    ),
    maxSteps: boundedInteger(limits.maxSteps, DEFAULT_LIMITS.maxSteps, 1, 1000, "maxSteps"),
    maxCostUsd: limits.maxCostUsd == null ? null : Number(limits.maxCostUsd),
  };
  if (
    normalizedLimits.maxCostUsd != null &&
    (!Number.isFinite(normalizedLimits.maxCostUsd) || normalizedLimits.maxCostUsd < 0)
  ) {
    throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, "maxCostUsd must be a non-negative number");
  }

  const temperature = input.sampling?.temperature ?? input.temperature ?? 0.3;
  const topP = input.sampling?.topP ?? input.topP ?? null;
  if (!Number.isFinite(Number(temperature)) || Number(temperature) < 0 || Number(temperature) > 2) {
    throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, "temperature must be between 0 and 2");
  }
  if (topP != null && (!Number.isFinite(Number(topP)) || Number(topP) <= 0 || Number(topP) > 1)) {
    throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, "topP must be greater than 0 and at most 1");
  }

  return Object.freeze({
    provider,
    endpoint: validateEndpoint(input.endpoint, input.network || {}),
    modelId,
    secretId: String(input.secretId || "agentApiKey"),
    capabilities: Object.freeze({
      tools: input.capabilities?.tools !== false,
      jsonMode: input.capabilities?.jsonMode === true,
    }),
    sampling: Object.freeze({
      temperature: Number(temperature),
      topP: topP == null ? null : Number(topP),
      seed: input.sampling?.seed ?? input.seed ?? null,
    }),
    limits: Object.freeze(normalizedLimits),
  });
}

function normalizeToolSchema(tools, maxBytes = DEFAULT_LIMITS.maxRequestBytes) {
  if (tools == null) return [];
  if (!Array.isArray(tools)) {
    throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, "Planner tools must be an array");
  }
  const normalized = tools.map((tool, index) => {
    const source = tool?.function || tool;
    const name = String(source?.name || "").trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(name)) {
      throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, `Planner tool ${index} has an invalid name`);
    }
    const parameters = source.parameters == null ? { type: "object", properties: {} } : source.parameters;
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
      throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, `Planner tool ${name} parameters must be JSON Schema`);
    }
    return {
      type: "function",
      function: {
        name,
        description: String(source.description || "").slice(0, 4096),
        parameters,
      },
    };
  });
  if (byteLength(JSON.stringify(normalized)) > maxBytes) {
    throw new BrainAdapterError(ERROR_CODES.REQUEST_TOO_LARGE, "Planner tool schema exceeds the request size limit");
  }
  return normalized;
}

function normalizeToolCalls(calls, maxArgumentsBytes) {
  if (calls == null) return [];
  if (!Array.isArray(calls)) {
    throw new BrainAdapterError(ERROR_CODES.INVALID_RESPONSE, "Provider tool_calls must be an array");
  }
  return calls.map((call, index) => {
    const name = String(call?.function?.name || call?.name || "").trim();
    let args = call?.function?.arguments ?? call?.arguments ?? "{}";
    if (typeof args !== "string") args = JSON.stringify(args);
    if (byteLength(args) > maxArgumentsBytes) {
      throw new BrainAdapterError(ERROR_CODES.TOOL_ARGUMENTS_TOO_LARGE, `Tool arguments for ${name || index} exceed the size limit`);
    }
    try {
      JSON.parse(args);
    } catch {
      throw new BrainAdapterError(ERROR_CODES.INVALID_RESPONSE, `Tool arguments for ${name || index} are not valid JSON`);
    }
    return {
      id: String(call?.id || `call_${index}`),
      type: "function",
      function: { name, arguments: args },
    };
  });
}

function normalizeUsage(usage = {}) {
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: Number(usage.total_tokens ?? promptTokens + completionTokens) || 0,
  };
}

function getRequestId(response, payload) {
  return (
    response?.headers?.get?.("x-request-id") ||
    response?.headers?.get?.("request-id") ||
    response?.headers?.get?.("trace-id") ||
    payload?.request_id ||
    payload?.id ||
    null
  );
}

async function readBoundedText(response, maxBytes) {
  const declared = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BrainAdapterError(ERROR_CODES.RESPONSE_TOO_LARGE, "Provider response exceeds the size limit");
  }
  if (!response?.body?.getReader) {
    const text = await response.text();
    if (byteLength(text) > maxBytes) {
      throw new BrainAdapterError(ERROR_CODES.RESPONSE_TOO_LARGE, "Provider response exceeds the size limit");
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BrainAdapterError(ERROR_CODES.RESPONSE_TOO_LARGE, "Provider response exceeds the size limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .filter((key) => !/(^key$|api.?key|authorization|credential|secret(?!Id)|token)/i.test(key))
      .sort()
      .reduce((out, key) => {
        out[key] = stableValue(value[key]);
        return out;
      }, {});
  }
  return value;
}

function buildEvaluationConfigSnapshot(input = {}) {
  const config = normalizeConfig(stableValue(input));
  return stableValue({
    contractVersion: 1,
    provider: config.provider,
    endpoint: config.endpoint,
    modelId: config.modelId,
    capabilities: config.capabilities,
    sampling: config.sampling,
    limits: {
      maxSteps: config.limits.maxSteps,
      maxOutputTokens: config.limits.maxOutputTokens,
      timeoutMs: config.limits.timeoutMs,
      maxCostUsd: config.limits.maxCostUsd,
      maxRequestBytes: config.limits.maxRequestBytes,
      maxResponseBytes: config.limits.maxResponseBytes,
      maxToolArgumentsBytes: config.limits.maxToolArgumentsBytes,
    },
  });
}

function createEvaluationConfigHash(input = {}) {
  const canonical = JSON.stringify(buildEvaluationConfigSnapshot(input));
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function combineAbortSignals(controller, externalSignal) {
  if (!externalSignal) return () => {};
  const abort = () => controller.abort(externalSignal.reason);
  if (externalSignal.aborted) abort();
  else externalSignal.addEventListener("abort", abort, { once: true });
  return () => externalSignal.removeEventListener("abort", abort);
}

function createOpenAiCompatibleAdapter(inputConfig, dependencies = {}) {
  const config = normalizeConfig(inputConfig);
  const evaluationConfig = buildEvaluationConfigSnapshot(inputConfig);
  const evaluationConfigHash = createEvaluationConfigHash(inputConfig);
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const keyResolver = dependencies.keyResolver;
  const now = dependencies.now || (() => Date.now());
  if (typeof fetchImpl !== "function") {
    throw new BrainAdapterError(ERROR_CODES.INVALID_CONFIG, "No fetch implementation is available");
  }
  if (typeof keyResolver !== "function" && typeof keyResolver?.get !== "function") {
    throw new BrainAdapterError(ERROR_CODES.BLOCKED, "Brain adapter SecretStore/key resolver is unavailable", {
      provider: config.provider,
      modelId: config.modelId,
      configHash: evaluationConfigHash,
    });
  }

  return Object.freeze({
    config,
    evaluationConfig,
    evaluationConfigHash,

    async complete(request = {}) {
      if (config.limits.maxCostUsd === 0) {
        throw new BrainAdapterError(ERROR_CODES.BLOCKED, "Brain adapter monetary budget is exhausted", {
          provider: config.provider,
          modelId: config.modelId,
          configHash: evaluationConfigHash,
        });
      }
      let key;
      try {
        key =
          typeof keyResolver === "function"
            ? await keyResolver(config.secretId, { provider: config.provider, modelId: config.modelId })
            : await keyResolver.get(config.secretId);
      } catch (cause) {
        throw new BrainAdapterError(ERROR_CODES.BLOCKED, "Brain adapter key resolution failed", {
          provider: config.provider,
          modelId: config.modelId,
          cause,
          configHash: evaluationConfigHash,
        });
      }
      if (!String(key || "").trim()) {
        throw new BrainAdapterError(ERROR_CODES.BLOCKED, "Brain adapter key is not configured", {
          provider: config.provider,
          modelId: config.modelId,
          configHash: evaluationConfigHash,
        });
      }

      const messages = Array.isArray(request.messages) ? request.messages : [];
      const tools = normalizeToolSchema(request.tools, config.limits.maxRequestBytes);
      if (tools.length && !config.capabilities.tools) {
        throw new BrainAdapterError(ERROR_CODES.BLOCKED, "Selected provider configuration does not enable tool calling", {
          provider: config.provider,
          modelId: config.modelId,
          configHash: evaluationConfigHash,
        });
      }
      const body = {
        model: config.modelId,
        messages,
        temperature: config.sampling.temperature,
        max_tokens: config.limits.maxOutputTokens,
      };
      if (config.sampling.topP != null) body.top_p = config.sampling.topP;
      if (config.sampling.seed != null) body.seed = config.sampling.seed;
      if (tools.length) {
        body.tools = tools;
        body.tool_choice = "auto";
      }
      const serialized = JSON.stringify(body);
      if (byteLength(serialized) > config.limits.maxRequestBytes) {
        throw new BrainAdapterError(ERROR_CODES.REQUEST_TOO_LARGE, "Brain adapter request exceeds the size limit", {
          provider: config.provider,
          modelId: config.modelId,
          configHash: evaluationConfigHash,
        });
      }

      const controller = new AbortController();
      const detachExternal = combineAbortSignals(controller, request.signal);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.limits.timeoutMs);
      const startedAt = now();
      let response;
      try {
        response = await fetchImpl(resolveCompletionUrl(config.endpoint), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${String(key).trim()}`,
          },
          body: serialized,
          signal: controller.signal,
          redirect: "error",
        });
        const raw = await readBoundedText(response, config.limits.maxResponseBytes);
        let payload;
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          throw new BrainAdapterError(ERROR_CODES.INVALID_RESPONSE, "Provider returned invalid JSON", {
            httpStatus: response.status,
            provider: config.provider,
            modelId: config.modelId,
            requestId: getRequestId(response),
          });
        }
        const requestId = getRequestId(response, payload);
        if (!response.ok) {
          const unsafeMessage = String(
            payload?.error?.message || payload?.message || `Provider HTTP ${response.status}`
          );
          const message = unsafeMessage.split(String(key).trim()).join("[REDACTED]");
          throw new BrainAdapterError(ERROR_CODES.HTTP_ERROR, String(message).slice(0, 2048), {
            httpStatus: response.status,
            provider: config.provider,
            modelId: config.modelId,
            requestId,
            retryable: response.status === 429 || response.status >= 500,
          });
        }
        const choice = payload?.choices?.[0];
        if (!choice || typeof choice !== "object") {
          throw new BrainAdapterError(ERROR_CODES.INVALID_RESPONSE, "Provider response has no completion choice", {
            provider: config.provider,
            modelId: config.modelId,
            requestId,
          });
        }
        if (payload.model != null && String(payload.model) !== config.modelId) {
          throw new BrainAdapterError(ERROR_CODES.MODEL_MISMATCH, "Provider returned an unexpected model ID; fallback is forbidden", {
            provider: config.provider,
            modelId: config.modelId,
            requestId,
          });
        }
        const message = choice.message || {};
        const content =
          typeof message.content === "string"
            ? message.content
            : Array.isArray(message.content)
              ? message.content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("")
              : "";
        return {
          ok: true,
          status: "COMPLETED",
          content: content.trim(),
          text: content.trim(),
          toolCalls: normalizeToolCalls(message.tool_calls, config.limits.maxToolArgumentsBytes),
          usage: normalizeUsage(payload.usage),
          finishReason: choice.finish_reason || null,
          requestId,
          traceId: response.headers?.get?.("trace-id") || response.headers?.get?.("x-trace-id") || null,
          provider: config.provider,
          model: String(payload.model || config.modelId),
          modelId: String(payload.model || config.modelId),
          latencyMs: Math.max(0, now() - startedAt),
          configHash: evaluationConfigHash,
        };
      } catch (error) {
        if (error instanceof BrainAdapterError) {
          error.provider ||= config.provider;
          error.modelId ||= config.modelId;
          error.requestId ||= response ? getRequestId(response) : null;
          error.latencyMs ??= Math.max(0, now() - startedAt);
          error.configHash ||= evaluationConfigHash;
          throw error;
        }
        if (timedOut) {
          throw new BrainAdapterError(ERROR_CODES.TIMEOUT, "Brain adapter request timed out", {
            provider: config.provider,
            modelId: config.modelId,
            cause: error,
            retryable: true,
            latencyMs: Math.max(0, now() - startedAt),
            configHash: evaluationConfigHash,
          });
        }
        if (controller.signal.aborted || error?.name === "AbortError") {
          throw new BrainAdapterError(ERROR_CODES.ABORTED, "Brain adapter request was aborted", {
            provider: config.provider,
            modelId: config.modelId,
            cause: error,
            latencyMs: Math.max(0, now() - startedAt),
            configHash: evaluationConfigHash,
          });
        }
        throw new BrainAdapterError(ERROR_CODES.HTTP_ERROR, "Brain adapter request failed", {
          provider: config.provider,
          modelId: config.modelId,
          cause: error,
          retryable: true,
          latencyMs: Math.max(0, now() - startedAt),
          configHash: evaluationConfigHash,
        });
      } finally {
        clearTimeout(timer);
        detachExternal();
        key = null;
      }
    },
  });
}

function toBlockedResult(error) {
  if (error instanceof BrainAdapterError && error.code === ERROR_CODES.BLOCKED) return error.toResult();
  throw error;
}

module.exports = {
  BrainAdapterError,
  ERROR_CODES,
  DEFAULT_LIMITS,
  buildEvaluationConfigSnapshot,
  createEvaluationConfigHash,
  createOpenAiCompatibleAdapter,
  normalizeConfig,
  normalizeToolSchema,
  normalizeToolCalls,
  normalizeUsage,
  resolveCompletionUrl,
  toBlockedResult,
  validateEndpoint,
};

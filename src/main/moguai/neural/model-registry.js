const {
  REASONS,
  deepFreeze,
  configHash,
  reason,
  isPlainObject,
} = require("./contracts");

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TIERS = Object.freeze({
  quality: new Set(["unknown", "low", "medium", "high", "premium"]),
  cost: new Set(["unknown", "free", "low", "medium", "high"]),
  latency: new Set(["unknown", "instant", "fast", "medium", "slow"]),
  reliability: new Set(["unknown", "low", "medium", "high"]),
});
function typedInvalid(profileId, code, message, field) {
  return deepFreeze({
    status: "INVALID",
    profileId: typeof profileId === "string" ? profileId : null,
    reason: reason(code, message, field ? { field } : {}),
  });
}

function containsSecretValue(value, path = []) {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const secretField =
      normalized !== "secretid" &&
      (normalized === "key" ||
        normalized.endsWith("key") ||
        normalized === "token" ||
        normalized.endsWith("token") ||
        normalized.includes("password") ||
        normalized.includes("authorization") ||
        normalized.includes("credential") ||
        normalized.includes("cookie") ||
        normalized.includes("secret"));
    if (secretField && child != null && child !== "") {
      return [...path, key].join(".");
    }
    const nested = containsSecretValue(child, [...path, key]);
    if (nested) return nested;
  }
  return null;
}

function safeEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

function normalizeCapabilities(value) {
  const capabilities = new Set();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) capabilities.add(item.trim());
      else if (isPlainObject(item) && typeof item.name === "string" && item.name.trim()) capabilities.add(item.name.trim());
    }
  } else if (isPlainObject(value)) {
    for (const [name, enabled] of Object.entries(value)) {
      if (enabled === true) capabilities.add(name);
      if (Array.isArray(enabled)) {
        for (const item of enabled) if (typeof item === "string" && item.trim()) capabilities.add(item.trim());
      }
    }
  }
  return [...capabilities].sort();
}

function validLimit(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizePricing(value) {
  if (!isPlainObject(value)) return null;
  const input = value.inputPerMillion;
  const output = value.outputPerMillion;
  if (
    typeof input !== "number" ||
    !Number.isFinite(input) ||
    input < 0 ||
    typeof output !== "number" ||
    !Number.isFinite(output) ||
    output < 0
  ) {
    return null;
  }
  return {
    currency: typeof value.currency === "string" ? value.currency.toUpperCase() : "USD",
    inputPerMillion: input,
    outputPerMillion: output,
  };
}

function validateTier(kind, value) {
  const normalized = value == null || value === "" ? "unknown" : String(value).toLowerCase();
  return TIERS[kind].has(normalized) ? normalized : null;
}

function validateProfile(input) {
  const id = input?.id;
  if (!isPlainObject(input)) return { invalid: typedInvalid(null, REASONS.INVALID_PROFILE, "Profile must be an object") };
  const secretPath = containsSecretValue(input);
  if (secretPath) {
    return { invalid: typedInvalid(id, REASONS.SECRET_VALUE_FORBIDDEN, "Profile contains a secret value", secretPath) };
  }
  for (const field of ["id", "provider", "modelId", "secretId"]) {
    if (typeof input[field] !== "string" || !ID_RE.test(input[field])) {
      const code = field === "secretId" ? REASONS.MISSING_SECRET_REFERENCE : REASONS.INVALID_PROFILE;
      return { invalid: typedInvalid(id, code, `Profile ${field} must be a safe reference`, field) };
    }
  }
  if (!safeEndpoint(input.endpoint)) {
    return { invalid: typedInvalid(id, REASONS.UNSAFE_ENDPOINT, "Endpoint must be HTTPS or loopback HTTP", "endpoint") };
  }
  const qualityTier = validateTier("quality", input.qualityTier || input.quality);
  const costTier = validateTier("cost", input.costTier);
  const latencyTier = validateTier("latency", input.latencyTier);
  const reliabilityTier = validateTier("reliability", input.reliabilityTier);
  if (!qualityTier || !costTier || !latencyTier || !reliabilityTier) {
    return { invalid: typedInvalid(id, REASONS.INVALID_PROFILE, "Profile contains an unsupported tier", "tiers") };
  }
  const contextWindowTokens = input.contextWindowTokens ?? input.maxContextTokens ?? input.contextWindow;
  const maxOutputTokens = input.maxOutputTokens ?? input.outputTokenLimit ?? input.outputLimit;
  if (!validLimit(contextWindowTokens) || !validLimit(maxOutputTokens) || maxOutputTokens > contextWindowTokens) {
    return { invalid: typedInvalid(id, REASONS.INVALID_PROFILE, "Profile token limits are invalid", "limits") };
  }
  return {
    profile: deepFreeze({
      id,
      label: typeof input.label === "string" ? input.label.slice(0, 256) : id,
      provider: input.provider,
      endpoint: new URL(input.endpoint).toString(),
      modelId: input.modelId,
      secretId: input.secretId,
      enabled: input.enabled === true,
      capabilities: normalizeCapabilities(input.capabilities),
      qualityTier,
      costTier,
      latencyTier,
      reliabilityTier,
      contextWindowTokens,
      maxOutputTokens,
      limits: isPlainObject(input.limits) ? deepFreeze({ ...input.limits }) : {},
      pricing: normalizePricing(input.pricing),
    }),
  };
}

class ModelRegistry {
  constructor(settings = {}) {
    this.load(settings);
  }

  static fromSettings(settings) {
    return new ModelRegistry(settings);
  }

  load(settings = {}) {
    const config = isPlainObject(settings.v22Config) ? settings.v22Config : settings;
    const inputs = Array.isArray(config.modelProfiles) ? config.modelProfiles : [];
    const profiles = [];
    const invalid = [];
    const seen = new Set();
    for (const input of inputs) {
      const result = validateProfile(input);
      if (result.invalid) {
        invalid.push(result.invalid);
        continue;
      }
      if (seen.has(result.profile.id)) {
        invalid.push(
          typedInvalid(result.profile.id, REASONS.DUPLICATE_PROFILE_ID, "Model profile IDs must be unique", "id")
        );
        continue;
      }
      seen.add(result.profile.id);
      profiles.push(result.profile);
    }
    this._profiles = deepFreeze(profiles);
    this._invalid = deepFreeze(invalid);
    this._byId = new Map(profiles.map((profile) => [profile.id, profile]));
    this._hash = configHash({ modelProfiles: profiles });
    return this;
  }

  get configHash() {
    return this._hash;
  }

  list(options = {}) {
    return this._profiles.filter((profile) => options.includeDisabled === true || profile.enabled);
  }

  get(id) {
    return this._byId.get(id) || null;
  }

  invalidProfiles() {
    return this._invalid;
  }

  snapshot() {
    return deepFreeze({
      profiles: this._profiles,
      invalidProfiles: this._invalid,
      configHash: this._hash,
    });
  }
}

module.exports = {
  ModelRegistry,
  validateProfile,
  normalizeCapabilities,
  safeEndpoint,
  TIERS,
};

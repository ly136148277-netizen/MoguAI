const {
  OUTCOMES,
  REASONS,
  deepFreeze,
  configHash,
  reason,
  blocked,
  isPlainObject,
} = require("./contracts");
const { ModelRegistry } = require("./model-registry");

const QUALITY_SCORE = Object.freeze({ unknown: 0, low: 1, medium: 2, high: 3, premium: 4 });
const COST_SCORE = Object.freeze({ unknown: 0, high: 1, medium: 2, low: 3, free: 4 });
const LATENCY_SCORE = Object.freeze({ unknown: 0, slow: 1, medium: 2, fast: 3, instant: 4 });
const RELIABILITY_SCORE = Object.freeze({ unknown: 0, low: 1, medium: 2, high: 3 });
const TERMINAL_FAILURES = new Set([
  REASONS.MODEL_MISMATCH,
  REASONS.MISSING_SECRET_REFERENCE,
  REASONS.INVALID_PROFILE,
  REASONS.UNSAFE_ENDPOINT,
  "BLOCKED",
  "INVALID_CONFIG",
  "PERMISSION_DENIED",
  "SAFETY_BLOCKED",
  "MISSING_KEY",
  "MISSING_SECRET",
  "MISSING_CREDENTIAL",
  "MODEL_MISMATCH",
]);

function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item))]
    : [];
}

function capabilityList(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => (typeof item === "string" ? item : isPlainObject(item) ? item.name : null))
        .filter((item) => typeof item === "string" && item)
    ),
  ];
}

function estimateCost(profile, constraints = {}) {
  if (!profile.pricing) return null;
  const inputTokens = Number(constraints.estimatedInputTokens ?? constraints.inputTokens ?? 0);
  const outputTokens = Number(constraints.estimatedOutputTokens ?? constraints.outputTokens ?? 0);
  if (![inputTokens, outputTokens].every((value) => Number.isFinite(value) && value >= 0)) return null;
  return (
    (inputTokens * profile.pricing.inputPerMillion + outputTokens * profile.pricing.outputPerMillion) /
    1_000_000
  );
}

function requiredCostLimit(constraints, budget) {
  for (const value of [
    constraints.maxCostUsd,
    constraints.maxEstimatedCostUsd,
    budget?.remainingCostUsd,
    budget?.maxCostUsd,
  ]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function rankScore(profile, explicitIndex) {
  return (
    1_000_000 - explicitIndex * 10_000 +
    QUALITY_SCORE[profile.qualityTier] * 100 +
    RELIABILITY_SCORE[profile.reliabilityTier] * 10 +
    LATENCY_SCORE[profile.latencyTier] * 2 +
    COST_SCORE[profile.costTier]
  );
}

function normalizeRouterArguments(registry, settings, options) {
  if (registry instanceof ModelRegistry) return { registry, settings: settings || {}, options: options || {} };
  if (isPlainObject(registry) && registry.registry instanceof ModelRegistry) {
    return { registry: registry.registry, settings: registry.settings || registry.config || {}, options: registry };
  }
  const source = registry || {};
  return { registry: new ModelRegistry(source), settings: source, options: settings || {} };
}

class ModelRouter {
  constructor(registry, settings = {}, options = {}) {
    const normalized = normalizeRouterArguments(registry, settings, options);
    this.registry = normalized.registry;
    const config = isPlainObject(normalized.settings.v22Config)
      ? normalized.settings.v22Config
      : normalized.settings;
    this.policies = deepFreeze(
      (Array.isArray(config.taskPolicies) ? config.taskPolicies : []).filter(
        (policy) => isPlainObject(policy) && policy.enabled === true && typeof policy.id === "string"
      )
    );
    this.allowModelFallback = config.allowModelFallback === true;
    this.hasSecret = typeof normalized.options.hasSecret === "function" ? normalized.options.hasSecret : null;
    this._configHash = configHash({
      registry: this.registry.snapshot(),
      taskPolicies: this.policies,
      allowModelFallback: this.allowModelFallback,
    });
  }

  route(classification, constraints = {}, budgetSnapshot = {}) {
    if (budgetSnapshot?.status === OUTCOMES.BLOCKED || budgetSnapshot?.blocked === true) {
      return blocked(
        budgetSnapshot.reason?.code || REASONS.BUDGET_EXHAUSTED,
        "Budget snapshot blocks model routing",
        { budgetReason: budgetSnapshot.reason || null }
      );
    }
    const taskClass = classification?.taskClass || classification?.category;
    const policy = this.policies.find(
      (candidate) =>
        candidate.id === constraints.policyId ||
        (!constraints.policyId && candidate.taskClass === taskClass)
    );
    if (!policy) {
      return blocked(REASONS.POLICY_NOT_FOUND, "No enabled owner policy matches this task", {
        taskClass: taskClass || null,
        configHash: this._configHash,
      });
    }

    const requiredCapabilities = [
      ...new Set([
        ...capabilityList(classification?.requiredCapabilities),
        ...capabilityList(policy.requiredCapabilities),
        ...capabilityList(constraints.requiredCapabilities),
      ]),
    ].sort();
    const configuredOrder = stringList(
      policy.profileOrder?.length
        ? policy.profileOrder
        : policy.selectedProfileIds?.length
          ? policy.selectedProfileIds
          : policy.modelProfileId
            ? [policy.modelProfileId]
            : []
    );
    if (policy.modelProfileId && !configuredOrder.includes(policy.modelProfileId)) {
      configuredOrder.unshift(policy.modelProfileId);
    }
    const allowed = new Set(stringList(policy.allowedProfileIds));
    const candidateIds = configuredOrder.filter((id) => !allowed.size || allowed.has(id));
    const rejected = [];
    const eligible = [];
    const costLimit = requiredCostLimit(constraints, budgetSnapshot);
    const availableSecretIds = Array.isArray(constraints.availableSecretIds)
      ? new Set(stringList(constraints.availableSecretIds))
      : null;

    for (let index = 0; index < candidateIds.length; index += 1) {
      const id = candidateIds[index];
      const profile = this.registry.get(id);
      let rejection = null;
      if (!profile) rejection = reason(REASONS.PROFILE_NOT_FOUND, "Owner-ordered profile is not registered", { profileId: id });
      else if (!profile.enabled) rejection = reason(REASONS.PROFILE_DISABLED, "Profile is disabled", { profileId: id });
      else {
        const missing = requiredCapabilities.filter((capability) => !profile.capabilities.includes(capability));
        if (missing.length) {
          rejection = reason(REASONS.MISSING_CAPABILITY, "Profile lacks required capabilities", {
            profileId: id,
            missingCapabilities: missing,
          });
        } else if (
          (this.hasSecret && this.hasSecret(profile.secretId) !== true) ||
          (availableSecretIds && !availableSecretIds.has(profile.secretId))
        ) {
          rejection = reason(REASONS.MISSING_SECRET_REFERENCE, "Referenced credential is unavailable", {
            profileId: id,
            secretId: profile.secretId,
          });
        } else {
          const estimatedCostUsd = estimateCost(profile, constraints);
          if (costLimit !== null && estimatedCostUsd === null) {
            rejection = reason(REASONS.UNKNOWN_PRICE, "Unknown pricing cannot satisfy a cost policy", { profileId: id });
          } else if (costLimit !== null && estimatedCostUsd > costLimit) {
            rejection = reason(REASONS.BUDGET_EXHAUSTED, "Estimated model cost exceeds policy", {
              profileId: id,
              estimatedCostUsd,
              costLimitUsd: costLimit,
            });
          } else {
            eligible.push({
              profile,
              rank: 0,
              score: rankScore(profile, index),
              estimatedCostUsd,
              explanation: [
                `owner order ${index + 1}`,
                `supports ${requiredCapabilities.join(", ") || "no additional capabilities"}`,
                `quality=${profile.qualityTier}`,
                `reliability=${profile.reliabilityTier}`,
                estimatedCostUsd === null ? "cost=unknown" : `estimatedCostUsd=${estimatedCostUsd}`,
              ],
            });
          }
        }
      }
      if (rejection) rejected.push({ profileId: id, reason: rejection });
    }

    eligible.sort((left, right) => right.score - left.score || left.profile.id.localeCompare(right.profile.id));
    eligible.forEach((candidate, index) => {
      candidate.rank = index + 1;
    });
    if (!eligible.length) {
      return deepFreeze({
        status: OUTCOMES.BLOCKED,
        reason: reason(REASONS.PROFILE_NOT_FOUND, "No eligible owner-registered model profile"),
        primaryProfile: null,
        alternatives: [],
        rejectedCandidates: rejected,
        configHash: this._configHash,
        requiredCapabilities,
        policyId: policy.id,
      });
    }

    const primary = eligible[0];
    return deepFreeze({
      status: OUTCOMES.SELECTED,
      decisionId: configHash({
        configHash: this._configHash,
        policyId: policy.id,
        taskClass,
        requiredCapabilities,
        constraints,
        candidateIds: eligible.map((item) => item.profile.id),
      }),
      primaryProfile: primary.profile,
      primary: primary,
      rankedCandidates: eligible,
      alternatives: eligible.slice(1),
      rejectedCandidates: rejected,
      configHash: this._configHash,
      requiredCapabilities,
      policyId: policy.id,
      allowModelFallback: this.allowModelFallback,
      ownerProfileOrder: candidateIds,
      audit: {
        type: "model.attempt.authorized",
        attemptNumber: 1,
        profileId: primary.profile.id,
        explicit: true,
      },
    });
  }

  decide(classification, constraints, budgetSnapshot) {
    return this.route(classification, constraints, budgetSnapshot);
  }

  nextCandidate(decision, failure = {}) {
    if (!decision || decision.status !== OUTCOMES.SELECTED) {
      return blocked(REASONS.INVALID_PROFILE, "A successful immutable routing decision is required");
    }
    const failureCode = failure.code || failure.reason?.code || "UNKNOWN_FAILURE";
    if (TERMINAL_FAILURES.has(failureCode)) {
      return blocked(failureCode, "Failure is fail-closed and cannot trigger model substitution", {
        failedProfileId: failure.profileId || decision.primaryProfile.id,
      });
    }
    if (decision.allowModelFallback !== true) {
      return deepFreeze({
        status: OUTCOMES.NO_FALLBACK,
        reason: reason(REASONS.FALLBACK_DISABLED, "Owner has not enabled model fallback"),
      });
    }
    const attempted = new Set(
      stringList(failure.attemptedProfileIds).concat(
        failure.profileId || decision.primaryProfile.id
      )
    );
    const next = decision.rankedCandidates.find(
      (candidate) => !attempted.has(candidate.profile.id) && decision.ownerProfileOrder.includes(candidate.profile.id)
    );
    if (!next) {
      return deepFreeze({
        status: OUTCOMES.EXHAUSTED,
        reason: reason(REASONS.FALLBACK_EXHAUSTED, "No untried eligible owner-ordered profile remains"),
      });
    }
    return deepFreeze({
      status: OUTCOMES.NEXT_CANDIDATE,
      profile: next.profile,
      candidate: next,
      audit: {
        type: "model.fallback.authorized",
        explicit: true,
        priorFailureCode: failureCode,
        attemptedProfileIds: [...attempted],
        profileId: next.profile.id,
        attemptNumber: attempted.size + 1,
      },
    });
  }
}

module.exports = {
  ModelRouter,
  estimateCost,
  rankScore,
};

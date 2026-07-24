const { TASK_CLASSES, COMPLEXITIES, deepFreeze } = require("./contracts");

const CLASS_CAPABILITIES = Object.freeze({
  chat: ["text"],
  coding: ["text", "code"],
  research: ["text", "research"],
  "creative-media": ["creative-media"],
  "pc-automation": ["pc-automation", "tools"],
  "safety-sensitive": ["text", "safety"],
});

const RULES = Object.freeze([
  ["safety-sensitive", /\b(safety|unsafe|danger|weapon|explosive|medical|diagnos|dosage|legal advice|self[- ]?harm|suicide|credential|secret|password|malware|ransomware)\b/i],
  ["pc-automation", /\b(click|desktop|computer|mouse|keyboard|open (?:the )?app|window|screen|gui|automate|browser)\b/i],
  ["coding", /\b(code|coding|function|class|bug|debug|refactor|test|repository|commit|typescript|javascript|python|java|sql|api|compiler)\b/i],
  ["research", /\b(research|investigate|compare|sources?|citations?|literature|evidence|find out|web search|analy[sz]e)\b/i],
  ["creative-media", /\b(image|video|audio|music|illustration|logo|poster|animation|creative media|generate art)\b/i],
]);

const CAPABILITY_HINTS = Object.freeze([
  ["vision", /\b(image|screenshot|vision|photo|diagram)\b/i],
  ["audio", /\b(audio|music|speech|voice)\b/i],
  ["video", /\b(video|animation)\b/i],
  ["tools", /\b(tool|execute|run|browse|search|click|automate)\b/i],
  ["json", /\b(json|structured output|schema)\b/i],
]);

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))].sort();
}

function normalizeInput(input) {
  if (typeof input === "string") return { text: input, hints: {} };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { text: "", hints: {} };
  const hints = input.hints && typeof input.hints === "object" ? input.hints : {};
  return {
    text: [input.text, input.prompt, input.message, input.title].filter((item) => typeof item === "string").join("\n"),
    hints: {
      taskClass: input.taskClass || input.taskType || hints.taskClass || hints.taskType,
      complexity: input.complexity || hints.complexity,
      requiredCapabilities:
        input.requiredCapabilities || input.capabilities || hints.requiredCapabilities || hints.capabilities,
      safetySensitive: input.safetySensitive === true || hints.safetySensitive === true,
    },
  };
}

function inferComplexity(text) {
  const high = /\b(architecture|migrate|multi[- ]?(?:step|file|system)|production|comprehensive|end[- ]to[- ]end|security audit)\b/i;
  const low = /\b(short|simple|quick|brief|one[- ]line|typo|hello|hi)\b/i;
  if (high.test(text) || text.length > 1600) return "high";
  if (low.test(text) && text.length < 400) return "low";
  return text.length > 500 ? "high" : text.length > 120 ? "medium" : "low";
}

function classifyTask(input = "") {
  const normalized = normalizeInput(input);
  const { text, hints } = normalized;
  const explicitClass = TASK_CLASSES.includes(hints.taskClass) ? hints.taskClass : null;
  const explicitComplexity = COMPLEXITIES.includes(hints.complexity) ? hints.complexity : null;
  const matchedRules = [];
  let taskClass = explicitClass;

  if (hints.safetySensitive) taskClass = "safety-sensitive";
  if (!taskClass) {
    for (const [candidate, pattern] of RULES) {
      if (pattern.test(text)) {
        taskClass = candidate;
        matchedRules.push(candidate);
        break;
      }
    }
  }
  if (!taskClass) taskClass = "chat";

  const requiredCapabilities = new Set(CLASS_CAPABILITIES[taskClass]);
  for (const [capability, pattern] of CAPABILITY_HINTS) {
    if (pattern.test(text)) requiredCapabilities.add(capability);
  }
  for (const capability of cleanStringArray(hints.requiredCapabilities)) requiredCapabilities.add(capability);

  const source = explicitClass || hints.safetySensitive ? "explicit-hint" : matchedRules.length ? "deterministic-rule" : "default";
  return deepFreeze({
    taskClass,
    category: taskClass,
    complexity: explicitComplexity || inferComplexity(text),
    requiredCapabilities: [...requiredCapabilities].sort(),
    classificationMethod: source,
    confidence: {
      kind: "heuristic",
      level: source === "explicit-hint" ? "explicit" : source === "deterministic-rule" ? "rule-match" : "default",
      isModelCertainty: false,
    },
    evidence: {
      explicitTaskClass: explicitClass,
      matchedRules,
    },
  });
}

class TaskClassifier {
  classify(input) {
    return classifyTask(input);
  }
}

module.exports = {
  TaskClassifier,
  classifyTask,
  CLASS_CAPABILITIES,
};

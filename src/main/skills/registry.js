const fs = require("fs-extra");
const path = require("path");

const SKILL_IDS = Object.freeze([
  "mogu.comfy",
  "mogu.studio",
  "mogu.ollama",
  "mogu.pc",
  "mogu.media",
  "mogu.coding",
  "mogu.search",
  "mogu.browser",
  "mogu.memory",
]);

const SKILL_META = Object.freeze({
  "mogu.comfy": {
    id: "mogu.comfy",
    title: "ComfyUI 工作流",
    summary: "列出工作流、提交/取消出片、进度与 prompt_id",
    riskDefault: 2,
    ops: ["list", "run", "cancel", "status", "preflight"],
    env: ["pai", "comfyui"],
    source: "comfy",
  },
  "mogu.studio": {
    id: "mogu.studio",
    title: "创作台出片",
    summary: "参数化创作台出片、预检、provenance、同参重试",
    riskDefault: 2,
    ops: ["run", "preflight", "retry"],
    env: ["pai", "comfyui"],
    source: "studio",
  },
  "mogu.ollama": {
    id: "mogu.ollama",
    title: "Ollama 模型",
    summary: "模型列表、导入、状态（与模型页一致）",
    riskDefault: 1,
    ops: ["list", "status", "import", "preflight"],
    env: ["ollama"],
    source: "pai",
  },
  "mogu.pc": {
    id: "mogu.pc",
    title: "本机助手",
    summary: "打开应用、搜索文件、备份 PAI（经权限代理）",
    riskDefault: 2,
    ops: ["open", "search", "backup", "run"],
    env: ["pai"],
    source: "pai",
  },
  "mogu.media": {
    id: "mogu.media",
    title: "视频合成",
    summary: "FFmpeg 拼接与路径白名单",
    riskDefault: 2,
    ops: ["concat", "ensure", "preflight"],
    env: ["ffmpeg"],
    source: "pai",
  },
  "mogu.coding": {
    id: "mogu.coding",
    title: "MOGU AI 编程",
    summary: "MOGU 双引擎编程：规则注入、自动验修、hunk 审阅、双引擎对比取优",
    riskDefault: 2,
    ops: [
      "status",
      "preflight",
      "run",
      "dispatch",
      "compare",
      "cancel",
      "retry",
      "trajectory",
      "review",
      "commit",
      "discard",
      "accept",
      "hunks",
      "rejectHunk",
      "acceptHunk",
      "projectContext",
      "planScope",
      "verify",
    ],
    env: [],
    source: "coding",
  },
  "mogu.search": {
    id: "mogu.search",
    title: "联网搜索",
    summary: "DuckDuckGo 即时答案与相关结果（无需单独 Key）",
    riskDefault: 1,
    ops: ["status", "preflight", "query", "run"],
    env: ["network"],
    source: "search",
  },
  "mogu.browser": {
    id: "mogu.browser",
    title: "浏览器",
    summary: "打开网页、抓取正文；Playwright 点击/填表/提取（外置）",
    riskDefault: 2,
    ops: ["status", "preflight", "open", "fetch", "act", "click", "fill", "extract", "run"],
    env: [],
    source: "browser",
  },
  "mogu.memory": {
    id: "mogu.memory",
    title: "长期记忆",
    summary: "分层记忆 preference/project/session（本地 JSON）",
    riskDefault: 1,
    ops: ["status", "preflight", "remember", "recall", "list", "forget"],
    env: [],
    source: "memory",
  },
});

function resolveSkillsRoot() {
  const candidates = [
    process.env.MOGU_SKILLS_ROOT,
    path.join(__dirname, "..", "..", "..", "skills"),
    path.join(process.cwd(), "skills"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.pathExistsSync(candidate)) return candidate;
  }
  return path.join(__dirname, "..", "..", "..", "skills");
}

async function readSkillMarkdown(skillId) {
  const file = path.join(resolveSkillsRoot(), skillId, "SKILL.md");
  if (!(await fs.pathExists(file))) return null;
  return fs.readFile(file, "utf8");
}

function defaultEnabledMap() {
  const map = {};
  for (const id of SKILL_IDS) map[id] = true;
  return map;
}

function mergeEnabled(settingsEnabled) {
  const base = defaultEnabledMap();
  if (!settingsEnabled || typeof settingsEnabled !== "object") return base;
  for (const id of SKILL_IDS) {
    if (Object.prototype.hasOwnProperty.call(settingsEnabled, id)) {
      base[id] = settingsEnabled[id] !== false;
    }
  }
  return base;
}

function listSkillDefs({ enabledMap } = {}) {
  const enabled = mergeEnabled(enabledMap);
  return SKILL_IDS.map((id) => ({
    ...SKILL_META[id],
    enabled: enabled[id] !== false,
  }));
}

function getSkillDef(skillId) {
  return SKILL_META[skillId] || null;
}

function skillIdToToolName(skillId) {
  return String(skillId || "").replace(/\./g, "_");
}

function toolNameToSkillId(toolName) {
  const name = String(toolName || "").trim();
  if (name.startsWith("mcp__")) return null;
  return name.replace(/_/g, ".");
}

/** OpenAI tool schemas aligned with registry ops (+ skill-specific args). */
function buildBrainToolsFromRegistry() {
  const extraProps = {
    "mogu.pc": {
      command: { type: "string", description: "完整中文命令" },
      app: { type: "string" },
      query: { type: "string" },
    },
    "mogu.comfy": {
      command: { type: "string" },
      workflowId: { type: "string" },
      promptId: { type: "string" },
    },
    "mogu.coding": {
      engine: { type: "string", enum: ["moguai_a", "moguai_b"] },
      workspace: { type: "string" },
      prompt: { type: "string" },
      model: { type: "string" },
      moguTaskId: { type: "string" },
      message: { type: "string", description: "git commit 说明（commit 操作用）" },
      command: { type: "string", description: "verify 命令，默认 npm test" },
      compare: { type: "boolean", description: "双引擎对比取优" },
      autoVerify: { type: "boolean", description: "改完自动跑测试并再修" },
      maxFixRounds: { type: "number", description: "自动再修轮数，默认 dispatch=3 / run=2" },
      hunkId: { type: "string", description: "rejectHunk / acceptHunk" },
      skipVerify: { type: "boolean" },
      allowPaths: { type: "array", description: "文件集锁定（显式路径）" },
      scopeMode: {
        type: "string",
        enum: ["trim", "warn", "strict", "off"],
        description: "越界：trim 回滚 / warn 仅提示 / strict 失败 / off 关闭",
      },
      scopeEnforce: { type: "boolean", description: "是否启用文件集拦截，默认 true" },
      localPatch: { type: "boolean", description: "直出多轮补丁（云端/本地）" },
    },
    "mogu.search": {
      query: { type: "string", description: "搜索关键词" },
      limit: { type: "number" },
    },
    "mogu.browser": {
      url: { type: "string" },
      engine: { type: "string", enum: ["fetch", "open", "playwright"] },
      selector: { type: "string", description: "CSS 选择器（click/fill/extract）" },
      value: { type: "string", description: "填表内容" },
      steps: {
        type: "array",
        description: "Playwright 步骤：goto/click/fill/extract/wait/press",
        items: { type: "object" },
      },
      headless: { type: "boolean" },
      maxChars: { type: "number" },
    },
    "mogu.memory": {
      key: { type: "string" },
      value: { type: "string" },
      query: { type: "string" },
      id: { type: "string" },
      tags: { type: "string" },
      layer: { type: "string", enum: ["preference", "project", "session"] },
      limit: { type: "number" },
    },
    "mogu.ollama": {
      modelPath: { type: "string" },
      name: { type: "string" },
    },
    "mogu.media": {
      inputs: { type: "array", items: { type: "string" } },
      output: { type: "string" },
    },
  };

  return SKILL_IDS.map((id) => {
    const def = SKILL_META[id];
    return {
      type: "function",
      function: {
        name: skillIdToToolName(id),
        description: `${def.title}：${def.summary}。ops=${def.ops.join("|")}`,
        parameters: {
          type: "object",
          properties: {
            op: { type: "string", enum: [...def.ops] },
            ...(extraProps[id] || {}),
          },
          required: ["op"],
        },
      },
    };
  });
}

module.exports = {
  SKILL_IDS,
  SKILL_META,
  resolveSkillsRoot,
  readSkillMarkdown,
  defaultEnabledMap,
  mergeEnabled,
  listSkillDefs,
  getSkillDef,
  skillIdToToolName,
  toolNameToSkillId,
  buildBrainToolsFromRegistry,
};

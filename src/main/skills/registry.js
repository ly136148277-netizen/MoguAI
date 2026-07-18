const fs = require("fs-extra");
const path = require("path");

const SKILL_IDS = Object.freeze([
  "mogu.comfy",
  "mogu.studio",
  "mogu.ollama",
  "mogu.pc",
  "mogu.media",
  "mogu.coding",
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
    title: "编程双引擎",
    summary: "Codex CLI + trae-agent 统一入口、任务追踪与换引擎重试",
    riskDefault: 2,
    ops: ["status", "preflight", "run", "cancel", "retry", "trajectory"],
    env: [],
    source: "coding",
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

module.exports = {
  SKILL_IDS,
  SKILL_META,
  resolveSkillsRoot,
  readSkillMarkdown,
  defaultEnabledMap,
  mergeEnabled,
  listSkillDefs,
  getSkillDef,
};

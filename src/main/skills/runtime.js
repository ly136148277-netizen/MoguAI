const path = require("path");
const fs = require("fs-extra");
const os = require("os");
const { gateCommand } = require("../permission-gate");
const {
  SKILL_IDS,
  getSkillDef,
  listSkillDefs,
  mergeEnabled,
  readSkillMarkdown,
  resolveSkillsRoot,
} = require("./registry");

const handlers = {
  "mogu.comfy": require("./handlers/comfy"),
  "mogu.studio": require("./handlers/studio"),
  "mogu.ollama": require("./handlers/ollama"),
  "mogu.pc": require("./handlers/pc"),
  "mogu.media": require("./handlers/media"),
  "mogu.coding": require("./handlers/coding"),
  "mogu.search": require("./handlers/search"),
  "mogu.browser": require("./handlers/browser"),
  "mogu.memory": require("./handlers/memory"),
};

const READ_OPS = new Set([
  "list",
  "status",
  "preflight",
  "ensure",
  "trajectory",
  "query",
  "recall",
  "fetch",
  "open",
  "remember",
  "forget",
]);
const SKIP_TASK_OPS = new Set([
  "list",
  "status",
  "preflight",
  "ensure",
  "trajectory",
  "cancel",
  "query",
  "recall",
  "fetch",
  "open",
  "remember",
  "forget",
]);

class SkillRuntime {
  /**
   * @param {{
   *   taskStore: any,
   *   permissionProxy: any,
   *   paiBridge: any,
   *   ollama: any,
   *   studioStore?: any,
   *   getSettings: () => Promise<object>,
   *   userDataPath?: string,
   *   logger?: any,
   *   emitProgress?: (p:any)=>void,
   * }} deps
   */
  constructor(deps = {}) {
    this.deps = deps;
  }

  async list() {
    const settings = await this.deps.getSettings();
    const enabledMap = mergeEnabled(settings.skillsEnabled);
    const defs = listSkillDefs({ enabledMap });
    const env = await this.probeEnv(settings);
    return {
      ok: true,
      skills: defs.map((def) => ({
        ...def,
        envOk: (def.env || []).every((key) => env[key] === true),
        env,
      })),
      env,
      skillsRoot: resolveSkillsRoot(),
    };
  }

  async probeEnv(settings) {
    const paiOk = await this.deps.paiBridge.ping(settings).catch(() => false);
    let comfyui = false;
    try {
      const { getComfyUiStatus } = require("../comfyui-bridge");
      const st = await getComfyUiStatus(this.deps.paiBridge.resolvePaiRoot(settings));
      comfyui = Boolean(st?.running);
    } catch {
      comfyui = false;
    }
    let ollama = false;
    let ollamaInstalled = false;
    try {
      const st = await this.deps.ollama.getStatus();
      ollama = Boolean(st?.running);
      ollamaInstalled = Boolean(st?.installed);
    } catch {
      /* ignore */
    }
    let ffmpeg = false;
    try {
      const { resolveFfmpeg } = require("../ffmpeg-tools");
      const r = await resolveFfmpeg();
      ffmpeg = Boolean(r?.path);
    } catch {
      ffmpeg = false;
    }
    return {
      pai: Boolean(paiOk),
      comfyui,
      ollama,
      ollamaInstalled,
      ffmpeg,
    };
  }

  async setEnabled(skillId, enabled) {
    if (!SKILL_IDS.includes(skillId)) {
      return { ok: false, error: `未知 Skill：${skillId}` };
    }
    const settings = await this.deps.getSettings();
    const next = mergeEnabled(settings.skillsEnabled);
    next[skillId] = enabled !== false;
    await this.deps.updateSettings?.({ skillsEnabled: next });
    return { ok: true, skillsEnabled: next };
  }

  async getDoc(skillId) {
    const def = getSkillDef(skillId);
    if (!def) return { ok: false, error: "unknown skill" };
    const markdown = await readSkillMarkdown(skillId);
    return { ok: true, skill: def, markdown };
  }

  async syncOpenclawDocs() {
    const destRoot = path.join(os.homedir(), ".openclaw", "skills");
    await fs.ensureDir(destRoot);
    const copied = [];
    for (const id of SKILL_IDS) {
      const src = path.join(resolveSkillsRoot(), id, "SKILL.md");
      if (!(await fs.pathExists(src))) continue;
      const destDir = path.join(destRoot, id);
      await fs.ensureDir(destDir);
      await fs.copy(src, path.join(destDir, "SKILL.md"));
      copied.push(id);
    }
    return { ok: true, destRoot, copied };
  }

  async listWhitelist() {
    const file = resolveWhitelistPath();
    if (!(await fs.pathExists(file))) {
      return { ok: true, skills: [], path: file };
    }
    const data = await fs.readJson(file);
    return { ok: true, skills: Array.isArray(data.skills) ? data.skills : [], path: file };
  }

  /**
   * Install a whitelist skill into userData/skills-ext (bundled skills just re-enable).
   */
  async installFromWhitelist(skillId) {
    const id = String(skillId || "").trim();
    const listed = await this.listWhitelist();
    const entry = (listed.skills || []).find((s) => s.id === id);
    if (!entry) {
      return { ok: false, error: "not_in_whitelist", message: `不在官方白名单：${id}` };
    }

    const bundledSrc = path.join(resolveSkillsRoot(), id, "SKILL.md");
    const extRoot =
      this.deps.userDataPath
        ? path.join(this.deps.userDataPath, "skills-ext", id)
        : path.join(os.tmpdir(), "mogu-skills-ext", id);
    await fs.ensureDir(extRoot);
    if (await fs.pathExists(bundledSrc)) {
      await fs.copy(bundledSrc, path.join(extRoot, "SKILL.md"));
    } else {
      await fs.writeFile(
        path.join(extRoot, "SKILL.md"),
        `# ${id}\n\nInstalled from official whitelist (${entry.version || "unknown"}).\n`,
        "utf8"
      );
    }

    const settings = await this.deps.getSettings();
    const next = mergeEnabled(settings.skillsEnabled);
    next[id] = true;
    await this.deps.updateSettings?.({ skillsEnabled: next });
    return { ok: true, skillId: id, path: extRoot, enabled: true };
  }

  async preflight(skillId, args = {}) {
    return this.invoke(skillId, "preflight", args, { skipPermission: true, skipTask: true });
  }

  /**
   * @param {string} skillId
   * @param {string} op
   * @param {object} args
   * @param {{ skipPermission?: boolean, skipTask?: boolean, channel?: string }} options
   */
  async invoke(skillId, op, args = {}, options = {}) {
    const def = getSkillDef(skillId);
    const handler = handlers[skillId];
    if (!def || !handler) {
      return { ok: false, error: `未知 Skill：${skillId}` };
    }

    const settings = await this.deps.getSettings();
    const enabledMap = mergeEnabled(settings.skillsEnabled);
    if (enabledMap[skillId] === false) {
      return { ok: false, error: `Skill 已禁用：${skillId}`, code: "skill_disabled" };
    }

    const operation = String(op || "run").trim();
    const fn = handler[operation];
    if (typeof fn !== "function") {
      return { ok: false, error: `Skill ${skillId} 不支持操作：${operation}` };
    }

    const deps = {
      ...this.deps,
      settings,
      emitProgress: this.deps.emitProgress,
    };

    let gate = null;
    if (!options.skipPermission && !READ_OPS.has(operation)) {
      const action = `${skillId}.${operation} ${summarizeArgs(args)}`.trim();
      gate = await gateCommand(this.deps.permissionProxy, action, {
        tool: skillId,
        riskLevel: Number(args?.riskLevel) || def.riskDefault || 2,
        channel: options.channel || args?.channel || "desktop",
        runId: args?.runId || null,
        requireGatewayApproval: args?.requireGatewayApproval === true,
        gatewayApproved: args?.gatewayApproved === true,
      });
      if (!gate.allowed) {
        return {
          ok: false,
          permissionDenied: true,
          error: gate.message,
          reason: gate.reason,
          riskLevel: gate.riskLevel,
        };
      }
    }

    let task = null;
    if (!options.skipTask && !SKIP_TASK_OPS.has(operation) && !READ_OPS.has(operation)) {
      task = await this.deps.taskStore.create({
        source: def.source || "pai",
        kind: `skill.${skillId}.${operation}`,
        executor: skillId,
        name: `${def.title}:${operation}`,
        status: "running",
        replay: {
          kind: `skill.${skillId}.${operation}`,
          payload: scrubArgs(args),
        },
      });
    }

    try {
      if (operation !== "preflight" && typeof handler.preflight === "function" && args?.skipPreflight !== true) {
        if (["run", "concat", "import"].includes(operation) || skillId === "mogu.studio") {
          // studio handler runs its own preflight; others optional soft-check only for media/comfy cancel
        }
      }

      const result = await fn({
        deps,
        args,
        gate,
        task,
        op: operation,
      });

      if (task?.moguTaskId && result && result.ok === false && result.code !== "preflight_failed") {
        const terminal = ["cancel"].includes(operation)
          ? result.ok
            ? "cancelled"
            : "failed"
          : "failed";
        await this.deps.taskStore.update(task.moguTaskId, {
          status: terminal,
          errorMessage: result.error || result.message || null,
          promptId: result.promptId || null,
          outputPaths: result.outputPaths || [],
        });
      } else if (task?.moguTaskId && result?.ok !== false && !result?.provenance) {
        // handlers may already finalize; default succeed for simple ops
        const current = await this.deps.taskStore.get(task.moguTaskId);
        if (current && current.status === "running") {
          await this.deps.taskStore.update(task.moguTaskId, {
            status: operation === "cancel" ? "cancelled" : "succeeded",
            promptId: result?.promptId || current.promptId,
            outputPaths: result?.outputPaths || current.outputPaths || [],
          });
        }
      }

      return {
        ok: result?.ok !== false,
        skillId,
        op: operation,
        moguTaskId: task?.moguTaskId || null,
        ...result,
      };
    } catch (error) {
      if (task?.moguTaskId) {
        await this.deps.taskStore.update(task.moguTaskId, {
          status: "failed",
          errorMessage: error.message,
        });
      }
      this.deps.logger?.warn?.("skill invoke failed", { skillId, op: operation, message: error.message });
      return {
        ok: false,
        skillId,
        op: operation,
        moguTaskId: task?.moguTaskId || null,
        error: error.message,
      };
    }
  }
}

function summarizeArgs(args) {
  if (!args || typeof args !== "object") return "";
  if (args.command) return String(args.command).slice(0, 120);
  if (args.query) return String(args.query).slice(0, 80);
  if (args.t2i_workflow || args.i2v_workflow) {
    return String(args.t2i_workflow || args.i2v_workflow).slice(0, 80);
  }
  if (Array.isArray(args.paths)) return `${args.paths.length} files`;
  return "";
}

function scrubArgs(args) {
  if (!args || typeof args !== "object") return {};
  const out = { ...args };
  for (const key of Object.keys(out)) {
    if (/(token|secret|password|api[-_]?key)/i.test(key)) delete out[key];
  }
  return out;
}

function resolveWhitelistPath() {
  const candidates = [
    process.env.MOGU_SKILLS_WHITELIST,
    path.join(__dirname, "..", "..", "..", "config", "skills-whitelist.json"),
    path.join(process.cwd(), "config", "skills-whitelist.json"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.pathExistsSync(candidate)) return candidate;
  }
  return candidates[1] || candidates[0];
}

module.exports = {
  SkillRuntime,
  handlers,
  resolveWhitelistPath,
};

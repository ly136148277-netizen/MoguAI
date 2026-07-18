function buildCommand(op, args = {}) {
  if (args.command) return String(args.command).trim();
  if (op === "open") {
    const target = args.app || args.name || args.target || "ComfyUI";
    return `打开 ${target}`;
  }
  if (op === "search") {
    const q = args.query || args.q || args.text || "";
    return `搜索 ${q}`.trim();
  }
  if (op === "backup") {
    return "备份 PAI";
  }
  return "";
}

async function preflight({ deps }) {
  const paiOk = await deps.paiBridge.ping(deps.settings);
  const issues = [];
  if (!paiOk) issues.push({ code: "pai_offline", message: "PAI 服务未运行（本机命令依赖 PAI）" });
  return { ok: issues.length === 0, issues, env: { pai: Boolean(paiOk) } };
}

async function run({ deps, args, gate, op }) {
  const command = buildCommand(op || args?.op || "run", args);
  if (!command) return { ok: false, error: "无法构造本机命令" };
  const level = Math.max(Number(args?.level) || 1, gate?.requiredLevel || 1);
  const result = await deps.paiBridge.run(deps.settings, gate?.confirmedCommand || command, level);
  return { ok: result?.ok !== false, result, command };
}

module.exports = {
  id: "mogu.pc",
  preflight,
  open: (ctx) => run({ ...ctx, op: "open" }),
  search: (ctx) => run({ ...ctx, op: "search" }),
  backup: (ctx) => run({ ...ctx, op: "backup" }),
  run,
  buildCommand,
};

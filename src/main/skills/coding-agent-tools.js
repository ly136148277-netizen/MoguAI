/**
 * Coding-agent tool adapters for unattended repair.
 * Reuses factory workspace-fs + SEARCH/REPLACE apply/verify — no whole-file overwrite.
 */
const path = require("path");
const fs = require("fs-extra");
const { spawnSync } = require("node:child_process");
const {
  listTree,
  searchWorkspace,
  readFileInWorkspace,
  assertInsideWorkspace,
  DEFAULT_IGNORE,
} = require("../moguai/factory/workspace-fs");
const {
  extractSearchReplaceBlocks,
  applySearchReplaceBlocks,
  filterBlocksToAllow,
  normalizeVerifyStages,
  resetWorkspaceToHead,
} = require("./coding-local-patch");
const { runVerifyWithOptionalDocker } = require("./coding-docker-verify");
const { findReferences } = require("./coding-find-refs");
const { createRepoIndex } = require("../moguai/intelligence/repo-index");
const { discoverTests } = require("../moguai/intelligence/test-discovery");

const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "set_plan",
      description:
        "REQUIRED before apply_patch. Record the repair plan: hypothesis, target production files, and approach. Call again if strategy changes.",
      parameters: {
        type: "object",
        properties: {
          hypothesis: {
            type: "string",
            description:
              "Selected repair hypothesis (what is broken and why). When diversity gate is on, this must be one distinct candidate.",
          },
          target_files: {
            type: "array",
            items: { type: "string" },
            description: "Workspace-relative production files to edit (prefer non-test)",
          },
          approach: { type: "string", description: "Concrete edit strategy" },
          candidate_hypotheses: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional. When B2-D2′ diversity is enabled: ≥2 distinct candidate repair hypotheses; hypothesis selects one.",
          },
        },
        required: ["hypothesis", "target_files", "approach"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_failure_consumption",
      description:
        "REQUIRED after a verify failure when Feedback-Consumption gate is on, BEFORE apply_patch. Explicitly bind last failure evidence to the next hypothesis. Fields must match the last verify/pack (objective checks).",
      parameters: {
        type: "object",
        properties: {
          failedStage: {
            type: "string",
            description: "Must match last verify failedStage (e.g. FAIL_TO_PASS)",
          },
          errorClass: {
            type: "string",
            description: "Must match last failure_class (e.g. f2p_miss, p2p_regression)",
          },
          failure_class: {
            type: "string",
            description: "Alias for errorClass",
          },
          evidence_used: {
            type: "string",
            description:
              "Locatable crumb from last verify: failing test name, AssertionError fragment, or file:line",
          },
          next_hypothesis: {
            type: "string",
            description: "New repair hypothesis; must differ from the previous hypothesis text",
          },
          diff_vs_previous: {
            type: "string",
            description: "Optional short note of how this differs from the last failed approach",
          },
        },
        required: ["failedStage", "evidence_used", "next_hypothesis"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_patch_binding",
      description:
        "REQUIRED after a verify failure when Evidence-to-Patch Binding (EPB) is on, BEFORE the next apply_patch. Call this then apply_patch; do not end the turn on git_diff alone. Explicit BINDING token to the open Evidence Object (evidence_id). Missing binding blocks apply.",
      parameters: {
        type: "object",
        properties: {
          evidence_id: {
            type: "string",
            description: "Must equal the open Evidence Object id from the last verify failure",
          },
          failed_stage: {
            type: "string",
            description: "Must match evidence failed_stage (e.g. FAIL_TO_PASS)",
          },
          failedStage: { type: "string", description: "Alias for failed_stage" },
          error_class: {
            type: "string",
            description: "Must match evidence error_class (e.g. f2p_miss, assertion)",
          },
          errorClass: { type: "string", description: "Alias for error_class" },
          intended_locus: {
            type: "string",
            description:
              "Path-shaped repair locus: path/file.py or file.py:line or file.py::symbol",
          },
          supersedes_prior: {
            type: "string",
            description:
              "Required on later post-fail applies: why abandoning the previous fail-path approach",
          },
          dependency_edge: {
            type: "string",
            description: "Optional: caller|callee|import|helper when fixing a dependent file",
          },
        },
        required: ["evidence_id", "intended_locus"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description:
        "Strong content search (ripgrep when available, else workspace scan). Prefer over search for symbols/regex. Supports glob and path scope.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex or fixed text" },
          path: { type: "string", description: "Subdir/file to scope (default .)" },
          glob: { type: "string", description: "File glob, e.g. *.py" },
          case_insensitive: { type: "boolean", description: "Case-insensitive (default false)" },
          max_hits: { type: "integer", description: "Max hits (default 40, max 80)" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search",
      description:
        "Quick filename + light symbol search. Use grep for regex / precise content matches.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Filename fragment, symbol, or text" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "Read a file slice (1-based lines). Use after search/grep to inspect real code.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative path" },
          start_line: { type: "integer", description: "1-based start line (default 1)" },
          max_lines: { type: "integer", description: "Max lines to return (default 200, max 400)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list",
      description: "List files/dirs under a relative directory (shallow).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative dir, default ." },
          max_depth: { type: "integer", description: "Max depth (default 2, max 4)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description:
        "Apply SEARCH/REPLACE edits (requires set_plan first). Auto-checkpoints before apply. Format each block as:\npath/to/file.py\n<<<<<<< SEARCH\nexact lines\n=======\nreplacement\n>>>>>>> REPLACE",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "string", description: "One or more SEARCH/REPLACE blocks" },
        },
        required: ["patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "checkpoint",
      description: "Save current working-tree state so you can rollback later.",
      parameters: {
        type: "object",
        properties: {
          label: { type: "string", description: "Optional label" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rollback",
      description:
        "Discard bad edits. to=head resets to HEAD; to=last restores last checkpoint; or pass a checkpoint id.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "head | last | <checkpoint_id>",
          },
        },
        required: ["to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_tests",
      description:
        "Run staged FAIL_TO_PASS / PASS_TO_PASS (or verify) commands. Uses Docker when MOGU_VERIFY_DOCKER_IMAGE is set.",
      parameters: {
        type: "object",
        properties: {
          stage: {
            type: "string",
            description: "Optional stage name filter, e.g. FAIL_TO_PASS",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "Show current git porcelain + unified diff summary of uncommitted changes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_intelligence",
      description:
        "Query the opt-in static repository index for files, symbols, definitions, references, imports, importers, or conservative call edges.",
      parameters: {
        type: "object",
        properties: {
          op: {
            type: "string",
            enum: ["files", "symbols", "definitions", "references", "imports", "importers", "calls", "refresh"],
          },
          symbol: { type: "string" },
          path: { type: "string" },
        },
        required: ["op"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "discover_tests",
      description: "Discover repository tests and verification stages without executing them.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "find_references",
      description:
        "List call sites for the symbol at file_path:line (jedi, else grep). Only available after the first verify failure. Prefer waiting for the automatic [引用分析] injection.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path or workspace-relative path",
          },
          line: { type: "integer", description: "1-based line number" },
          symbol_name: {
            type: "string",
            description: "Optional; if omitted, inferred from the line",
          },
        },
        required: ["file_path", "line"],
      },
    },
  },
];

function truncate(text, max = 6000) {
  const s = String(text || "");
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n...[truncated ${s.length - max} chars]`;
}

function normalizeRel(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

function isTestPath(p) {
  const s = normalizeRel(p);
  return /(^|\/)tests?\//.test(s) || /(^|\/)test_/.test(s) || /_test\.py$/.test(s);
}

function demoteTestHits(hits) {
  return [...hits].sort((a, b) => Number(isTestPath(a.path)) - Number(isTestPath(b.path)));
}

function gitDiffSummary(workspace) {
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  const diff = spawnSync("git", ["diff", "--", "."], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  const porcelain = String(status.stdout || "").trim();
  const body = String(diff.stdout || "").trim();
  return truncate(
    [`porcelain:\n${porcelain || "(clean)"}`, "", `diff:\n${body || "(empty)"}`].join("\n"),
    8000
  );
}

function isDirty(workspace) {
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  return String(status.stdout || "").trim().length > 0;
}

function captureTreePatch(workspace) {
  const tracked = spawnSync("git", ["diff", "HEAD", "--", "."], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  const untracked = spawnSync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    {
      cwd: workspace,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    }
  );
  const extras = [];
  for (const rel of String(untracked.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40)) {
    try {
      const abs = path.join(workspace, rel);
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > 512 * 1024) continue;
      const body = fs.readFileSync(abs, "utf8");
      extras.push({ path: normalizeRel(rel), content: body });
    } catch {
      /* ignore */
    }
  }
  return {
    diff: String(tracked.stdout || ""),
    extras,
    dirty: isDirty(workspace),
  };
}

function applyTreePatch(workspace, snap) {
  resetWorkspaceToHead(workspace);
  const diff = String(snap?.diff || "");
  if (diff.trim()) {
    const r = spawnSync("git", ["apply", "--whitespace=nowarn", "-"], {
      cwd: workspace,
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
      input: diff,
    });
    if (r.status !== 0) {
      return {
        ok: false,
        error: `git apply failed: ${(r.stderr || r.stdout || "").slice(0, 500)}`,
      };
    }
  }
  for (const f of snap?.extras || []) {
    const rel = normalizeRel(f.path);
    if (!rel) continue;
    try {
      assertInsideWorkspace(workspace, rel);
      fs.outputFileSync(path.join(workspace, rel), String(f.content || ""), "utf8");
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  }
  return { ok: true };
}

function findRg() {
  const r = spawnSync("rg", ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (r.status === 0) return "rg";
  return null;
}

/**
 * Ripgrep-first content search; Node fallback scan.
 */
async function grepWorkspace(workspace, opts = {}) {
  const pattern = String(opts.pattern || "").trim();
  if (!pattern) return { ok: false, error: "empty pattern", hits: [] };
  const scope = normalizeRel(opts.path || ".");
  const glob = String(opts.glob || "").trim();
  const insensitive = Boolean(opts.case_insensitive);
  const maxHits = Math.min(80, Math.max(1, Number(opts.max_hits) || 40));
  const root = path.resolve(workspace);
  const { abs: scopeAbs } = assertInsideWorkspace(root, scope === "." ? "" : scope);
  const rg = findRg();

  if (rg) {
    const args = [
      "--json",
      "--line-number",
      "--no-heading",
      "--color",
      "never",
      "--max-count",
      "3",
      "-m",
      String(maxHits),
    ];
    if (insensitive) args.push("-i");
    if (glob) args.push("--glob", glob);
    for (const name of DEFAULT_IGNORE) {
      args.push("--glob", `!${name}`, "--glob", `!**/${name}/**`);
    }
    args.push("--glob", "!.git/**");
    args.push("-e", pattern, scopeAbs);
    const r = spawnSync(rg, args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const hits = [];
    for (const line of String(r.stdout || "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type !== "match") continue;
      const data = obj.data || {};
      const absPath = String(data.path?.text || "");
      const rel = normalizeRel(path.relative(root, absPath));
      if (!rel || rel.startsWith("..")) continue;
      const text = String(data.lines?.text || "").replace(/\r?\n$/, "");
      hits.push({
        path: rel,
        line: Number(data.line_number) || 0,
        preview: text.trim().slice(0, 200),
      });
      if (hits.length >= maxHits) break;
    }
    return {
      ok: true,
      engine: "rg",
      hits: demoteTestHits(hits).slice(0, maxHits),
      truncated: hits.length >= maxHits,
    };
  }

  // Node fallback: walk + RegExp
  let re;
  try {
    re = new RegExp(pattern, insensitive ? "i" : "");
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(escaped, insensitive ? "i" : "");
  }
  const listed = await listTree(root, { maxEntries: 2500, maxDepth: 10 });
  const prefix = scope === "." || scope === "" ? "" : `${scope.replace(/\/$/, "")}/`;
  const hits = [];
  const codeExt = new Set([
    "js",
    "mjs",
    "cjs",
    "ts",
    "tsx",
    "jsx",
    "py",
    "json",
    "md",
    "css",
    "html",
    "java",
    "go",
    "rs",
    "c",
    "cc",
    "cpp",
    "h",
  ]);
  for (const entry of listed.entries || []) {
    if (hits.length >= maxHits) break;
    if (entry.type !== "file") continue;
    if (prefix && entry.path !== scope && !entry.path.startsWith(prefix)) continue;
    if (glob) {
      // minimal glob: *.ext or suffix
      const g = glob.replace(/^\*\./, ".");
      if (glob.startsWith("*.") && !entry.name.endsWith(g)) continue;
      if (!glob.startsWith("*") && !entry.path.includes(glob.replace(/\*/g, ""))) continue;
    }
    const ext = String(entry.name.split(".").pop() || "").toLowerCase();
    if (!codeExt.has(ext)) continue;
    if ((entry.size || 0) > 512 * 1024) continue;
    let text;
    try {
      text = await fs.readFile(path.join(root, entry.path), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    let perFile = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (hits.length >= maxHits || perFile >= 3) break;
      if (!re.test(lines[i])) continue;
      hits.push({
        path: entry.path,
        line: i + 1,
        preview: lines[i].trim().slice(0, 200),
      });
      perFile += 1;
    }
  }
  return {
    ok: true,
    engine: "node",
    hits: demoteTestHits(hits).slice(0, maxHits),
    truncated: hits.length >= maxHits,
  };
}

/**
 * @param {{
 *   workspace: string,
 *   allowPaths?: string[],
 *   verifyCommand?: string,
 *   verifyStages?: Array<{name?: string, command: string}>,
 *   dockerImage?: string,
 *   dockerStrict?: boolean,
 *   dockerSwe?: boolean,
 *   requirePlan?: boolean,
 *   authorizeCommand?: (payload: object) => Promise<object|boolean>,
 * }} ctx
 */
function createCodingToolRunner(ctx = {}) {
  const workspace = String(ctx.workspace || "").trim();
  const allowPaths = Array.isArray(ctx.allowPaths) ? ctx.allowPaths.map(normalizeRel).filter(Boolean) : [];
  const stages = normalizeVerifyStages(ctx.verifyCommand, ctx.verifyStages);
  const dockerImage = String(ctx.dockerImage || process.env.MOGU_VERIFY_DOCKER_IMAGE || "").trim();
  const dockerStrict = Boolean(ctx.dockerStrict) || process.env.MOGU_SWE_DOCKER_VERIFY === "1";
  const dockerSwe =
    Boolean(ctx.dockerSwe) ||
    process.env.MOGU_VERIFY_DOCKER_SWE === "1" ||
    /sweb\.eval\./i.test(dockerImage);
  const requirePlan = ctx.requirePlan !== false;
  const authorizeCommand =
    typeof ctx.authorizeCommand === "function" ? ctx.authorizeCommand : null;
  const repoIntelligenceEnabled = ctx.repoIntelligence === true;
  let repoIndex = null;
  const used = [];
  const checkpoints = [];
  let plan = null;
  let applyCount = 0;
  // find_references gated until first verify failure (Phase 2 — no pre-call).
  let findRefsAllowed = Boolean(ctx.findRefsAllowed);

  function saveCheckpoint(label = "") {
    const id = `cp${checkpoints.length + 1}`;
    const snap = captureTreePatch(workspace);
    const entry = {
      id,
      label: String(label || "").trim() || id,
      at: new Date().toISOString(),
      ...snap,
    };
    checkpoints.push(entry);
    if (checkpoints.length > 12) checkpoints.shift();
    return entry;
  }

  async function execute(name, rawArgs = {}) {
    const tool = String(name || "").trim();
    used.push(tool);
    try {
      if (tool === "set_plan") {
        const hypothesis = String(rawArgs.hypothesis || "").trim();
        const approach = String(rawArgs.approach || "").trim();
        const target_files = (Array.isArray(rawArgs.target_files) ? rawArgs.target_files : [])
          .map(normalizeRel)
          .filter(Boolean)
          .slice(0, 20);
        const candidate_hypotheses = (
          Array.isArray(rawArgs.candidate_hypotheses) ? rawArgs.candidate_hypotheses : []
        )
          .map((c) => String(c || "").trim())
          .filter(Boolean)
          .slice(0, 8);
        if (!hypothesis || !approach || !target_files.length) {
          return "ERROR: set_plan needs hypothesis, non-empty target_files, and approach.";
        }
        const testHeavy = target_files.filter(isTestPath);
        plan = {
          hypothesis,
          approach,
          target_files,
          candidate_hypotheses,
          at: new Date().toISOString(),
        };
        return truncate(
          [
            `ok=true plan_set files=${target_files.join(", ")}`,
            candidate_hypotheses.length
              ? `candidates=${candidate_hypotheses.length}`
              : "",
            testHeavy.length
              ? `WARN: test-like targets (${testHeavy.join(", ")}); prefer production modules unless harness bug.`
              : "",
            `hypothesis: ${hypothesis}`,
            `approach: ${approach}`,
          ]
            .filter(Boolean)
            .join("\n"),
          2000
        );
      }

      if (tool === "record_failure_consumption") {
        // Objective §2.1 validation is enforced in the agent loop.
        const failedStage = String(rawArgs.failedStage || rawArgs.failed_stage || "").trim();
        const errorClass = String(
          rawArgs.errorClass || rawArgs.error_class || rawArgs.failure_class || ""
        ).trim();
        const evidence_used = String(rawArgs.evidence_used || rawArgs.evidenceUsed || "").trim();
        const next_hypothesis = String(
          rawArgs.next_hypothesis || rawArgs.nextHypothesis || rawArgs.hypothesis || ""
        ).trim();
        if (!failedStage || !evidence_used || !next_hypothesis) {
          return "ERROR: record_failure_consumption needs failedStage, evidence_used, next_hypothesis";
        }
        return truncate(
          [
            `ok=true consumption_recorded`,
            `failedStage=${failedStage}`,
            `errorClass=${errorClass || "-"}`,
            `evidence_used=${evidence_used.slice(0, 240)}`,
            `next_hypothesis=${next_hypothesis.slice(0, 240)}`,
          ].join("\n"),
          2000
        );
      }

      if (tool === "record_patch_binding") {
        // Objective EPB validation is enforced in the agent loop before this echo.
        const evidence_id = String(rawArgs.evidence_id || rawArgs.evidenceId || "").trim();
        const failed_stage = String(
          rawArgs.failed_stage || rawArgs.failedStage || ""
        ).trim();
        const error_class = String(
          rawArgs.error_class || rawArgs.errorClass || rawArgs.failure_class || ""
        ).trim();
        const intended_locus = String(
          rawArgs.intended_locus || rawArgs.intendedLocus || ""
        ).trim();
        if (!evidence_id || !intended_locus) {
          return "ERROR: record_patch_binding needs evidence_id and intended_locus";
        }
        return truncate(
          [
            `ok=true BINDING_VALID`,
            `evidence_id=${evidence_id}`,
            `failed_stage=${failed_stage || "-"}`,
            `error_class=${error_class || "-"}`,
            `intended_locus=${intended_locus.slice(0, 240)}`,
          ].join("\n"),
          2000
        );
      }

      if (tool === "grep") {
        const r = await grepWorkspace(workspace, rawArgs);
        if (!r.ok) return `ERROR: ${r.error || "grep failed"}`;
        const lines = (r.hits || []).map((h) => `${h.path}:${h.line}: ${h.preview}`);
        return truncate(
          `engine=${r.engine} pattern=${rawArgs.pattern} hits=${lines.length}\n${lines.join("\n") || "(none)"}`
        );
      }

      if (tool === "search") {
        const query = String(rawArgs.query || "").trim();
        const r = await searchWorkspace(workspace, query, { maxHits: 40, maxContentFiles: 80 });
        const hits = demoteTestHits(r.hits || []).slice(0, 40);
        const lines = hits.map((h) =>
          h.kind === "file" ? `FILE ${h.path}` : `${h.path}:${h.line}: ${h.preview}`
        );
        return truncate(`query=${query}\nhits=${lines.length}\n${lines.join("\n") || "(none)"}`);
      }

      if (tool === "read") {
        const rel = normalizeRel(rawArgs.path);
        assertInsideWorkspace(workspace, rel);
        const file = await readFileInWorkspace(workspace, rel);
        const all = String(file.content || "").replace(/\r\n/g, "\n").split("\n");
        const start = Math.max(1, Number(rawArgs.start_line) || 1);
        const maxLines = Math.min(400, Math.max(1, Number(rawArgs.max_lines) || 200));
        const slice = all.slice(start - 1, start - 1 + maxLines);
        const numbered = slice.map((l, i) => `${start + i}|${l}`).join("\n");
        return truncate(`${rel} lines ${start}-${start + slice.length - 1}/${all.length}\n${numbered}`);
      }

      if (tool === "list") {
        const rel = normalizeRel(rawArgs.path || ".");
        const depth = Math.min(4, Math.max(1, Number(rawArgs.max_depth) || 2));
        const listed = await listTree(workspace, { maxDepth: depth, maxEntries: 400 });
        const prefix = rel === "." || rel === "" ? "" : `${rel.replace(/\/$/, "")}/`;
        const entries = (listed.entries || [])
          .filter((e) => !prefix || e.path === rel || e.path.startsWith(prefix))
          .slice(0, 200)
          .map((e) => `${e.type}\t${e.path}`);
        return truncate(`under=${rel || "."}\n${entries.join("\n") || "(empty)"}`);
      }

      if (tool === "checkpoint") {
        const entry = saveCheckpoint(rawArgs.label);
        return `ok=true id=${entry.id} label=${entry.label} dirty=${entry.dirty} extras=${(entry.extras || []).length}`;
      }

      if (tool === "rollback") {
        const to = String(rawArgs.to || "").trim().toLowerCase();
        if (!to) return "ERROR: rollback needs to=head|last|<id>";
        if (to === "head") {
          resetWorkspaceToHead(workspace);
          return `ok=true rolled_to=head dirty=${isDirty(workspace)}`;
        }
        let target = null;
        if (to === "last") target = checkpoints[checkpoints.length - 1];
        else target = checkpoints.find((c) => c.id.toLowerCase() === to || c.label.toLowerCase() === to);
        if (!target) {
          return `ERROR: unknown checkpoint ${to}; known=${checkpoints.map((c) => c.id).join(",") || "(none)"}`;
        }
        const applied = applyTreePatch(workspace, target);
        if (!applied.ok) return `ERROR rollback failed: ${applied.error}`;
        return `ok=true rolled_to=${target.id} dirty=${isDirty(workspace)}`;
      }

      if (tool === "apply_patch") {
        if (requirePlan && !plan) {
          return "ERROR: call set_plan first (hypothesis + target_files + approach) before apply_patch.";
        }
        const raw = String(rawArgs.patch || "");
        let blocks = extractSearchReplaceBlocks(raw);
        if (!blocks.length) {
          return "ERROR: no SEARCH/REPLACE blocks parsed. Emit path + <<<<<<< SEARCH / ======= / >>>>>>> REPLACE.";
        }
        if (allowPaths.length) {
          blocks = filterBlocksToAllow(blocks, allowPaths);
          if (!blocks.length) {
            return `ERROR: blocks outside allowPaths: ${allowPaths.slice(0, 12).join(", ")}`;
          }
        }
        applyCount += 1;
        const cp = saveCheckpoint(`pre_apply_${applyCount}`);
        const testOnly = blocks.every((b) => isTestPath(b.file));
        const offPlan =
          plan?.target_files?.length &&
          !blocks.some((b) =>
            plan.target_files.some(
              (t) => b.file === t || b.file.endsWith(`/${t}`) || t.endsWith(`/${b.file}`)
            )
          );
        const applied = applySearchReplaceBlocks(workspace, blocks);
        if (!applied.ok) {
          return truncate(
            `ERROR apply failed (checkpoint=${cp.id}): ${applied.error || ""}\n${applied.log || ""}`,
            4000
          );
        }
        const dirty = isDirty(workspace);
        return truncate(
          [
            `ok=true files=${blocks.map((b) => b.file).join(", ")} dirty=${dirty} checkpoint=${cp.id}`,
            testOnly ? "WARN: only test files changed; prefer production/library code." : "",
            offPlan
              ? `WARN: edited files not in set_plan targets (${plan.target_files.join(", ")}); update plan or rollback.`
              : "",
            applied.log || "",
          ]
            .filter(Boolean)
            .join("\n"),
          4000
        );
      }

      if (tool === "run_tests") {
        if (!stages.length) {
          return "NO_VERIFY: no FAIL_TO_PASS/PASS_TO_PASS stages configured for this task.";
        }
        const filter = String(rawArgs.stage || "").trim();
        const selected = filter
          ? stages.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()))
          : stages;
        if (!selected.length) return `ERROR: no stage matching ${filter}`;
        if (!authorizeCommand) {
          return "ERROR: authorization_required: run_tests requires an injected command authorization callback";
        }
        for (const stage of selected) {
          const decision = await authorizeCommand({
            tool: "mogu.coding.run_tests",
            action: "verify",
            riskLevel: 2,
            executable: "system-shell",
            command: stage.command,
            cwd: workspace,
            stage: stage.name,
          });
          if (!(decision === true || decision?.allowed === true)) {
            return `ERROR: authorization_denied: ${decision?.message || decision?.reason || `run_tests denied for ${stage.name}`}`;
          }
        }
        const verify = runVerifyWithOptionalDocker(workspace, selected, {
          timeoutMs: 300_000,
          dockerImage,
          dockerStrict,
          dockerSwe,
        });
        if (verify.skipped) return "NO_VERIFY";
        const parts = (verify.results || []).map(
          (r) =>
            `[${r.name}] ok=${r.ok} kind=${r.kind || ""}\ncmd: ${r.command}\n${r.log || r.error || ""}`
        );
        const softEnv = verify.kind === "env" && !dockerStrict;
        const hint = !verify.ok
          ? softEnv
            ? "\nHINT: host env missing deps (soft). Prefer Docker SWE verify."
            : "\nHINT: real verify failed — read stack, rollback if wrong file, set_plan again, then patch. Do NOT treat this as success."
          : "";
        return truncate(
          `ok=${verify.ok} failedStage=${verify.failedStage || "-"} via=${verify.via || "host"} strict=${Boolean(dockerStrict)}\n${parts.join("\n---\n")}${hint}`,
          7000
        );
      }

      if (tool === "git_diff") {
        return gitDiffSummary(workspace);
      }

      if (tool === "repo_intelligence") {
        if (!repoIntelligenceEnabled) return "ERROR: repo intelligence is disabled";
        if (!repoIndex) repoIndex = createRepoIndex(workspace);
        const op = String(rawArgs.op || "").trim();
        let result;
        if (op === "refresh") result = repoIndex.update();
        else if (op === "files") result = repoIndex.listFiles();
        else if (op === "symbols") result = repoIndex.getSymbols(rawArgs.path);
        else if (op === "definitions") result = repoIndex.findDefinitions(rawArgs.symbol);
        else if (op === "references") result = repoIndex.findReferences(rawArgs.symbol);
        else if (op === "imports") result = repoIndex.getImports(rawArgs.path);
        else if (op === "importers") result = repoIndex.getImporters(rawArgs.path);
        else if (op === "calls") result = repoIndex.getCallEdges(rawArgs.symbol);
        else return `ERROR: unknown repo intelligence op ${op}`;
        return truncate(JSON.stringify({ ok: true, op, result }, null, 2), 7000);
      }

      if (tool === "discover_tests") {
        if (!repoIntelligenceEnabled) return "ERROR: repo intelligence is disabled";
        return truncate(JSON.stringify(discoverTests(workspace), null, 2), 7000);
      }

      if (tool === "find_references") {
        if (!findRefsAllowed && process.env.MOGU_FIND_REFS !== "force") {
          return "ERROR: find_references is only available after the first verify failure. Wait for [引用分析] or continue with grep/read until then.";
        }
        const result = findReferences({
          workspace,
          file_path: rawArgs.file_path || rawArgs.filePath,
          line: rawArgs.line,
          symbol_name: rawArgs.symbol_name || rawArgs.symbolName,
          maxRefs: 12,
        });
        const lines = (result.refs || []).map((r) => `${r.file}:${r.line}: ${r.text}`);
        return truncate(
          [
            `ok=${result.ok} engine=${result.engine} symbol=${result.symbol || "-"} count=${lines.length}`,
            result.error ? `note=${result.error}` : "",
            lines.join("\n") || "(none)",
          ]
            .filter(Boolean)
            .join("\n"),
          5000
        );
      }

      return `ERROR: unknown tool ${tool}`;
    } catch (error) {
      return `ERROR: ${error.code || "tool_failed"}: ${error.message || String(error)}`;
    }
  }

  return {
    defs: repoIntelligenceEnabled
      ? TOOL_DEFS
      : TOOL_DEFS.filter(
          (def) => !["repo_intelligence", "discover_tests"].includes(def.function.name)
        ),
    execute,
    getUsed: () => [...used],
    getPlan: () => (plan ? { ...plan } : null),
    getCheckpoints: () => checkpoints.map((c) => ({ id: c.id, label: c.label, at: c.at })),
    getGitDiff: () => gitDiffText(workspace),
    getTouchedFiles: () => gitTouchedFiles(workspace),
    stages,
    isDirty: () => isDirty(workspace),
    allowFindRefs: () => {
      findRefsAllowed = true;
    },
    findRefsAllowed: () => findRefsAllowed,
  };
}

function gitDiffText(workspace) {
  const r = spawnSync("git", ["diff", "HEAD", "--", "."], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  return String(r.stdout || "");
}

function gitTouchedFiles(workspace) {
  const r = spawnSync("git", ["diff", "HEAD", "--name-only", "--", "."], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  return String(r.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.replace(/\\/g, "/").trim())
    .filter(Boolean);
}

module.exports = {
  TOOL_DEFS,
  createCodingToolRunner,
  gitDiffSummary,
  isDirty,
  grepWorkspace,
  captureTreePatch,
  applyTreePatch,
  runVerifyWithOptionalDocker, // re-export
};

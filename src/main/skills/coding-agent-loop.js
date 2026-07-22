/**
 * MOGU coding agent loop: plan → grep/search → read → apply_patch → run_tests → rollback/retry.
 * Unattended worker capability (not a Cursor clone).
 */
const path = require("path");
const { createCodingToolRunner } = require("./coding-agent-tools");
const { runVerifyWithOptionalDocker } = require("./coding-docker-verify");
const { normalizeVerifyStages } = require("./coding-local-patch");
const {
  extractStackAnchor,
  buildAnchorInjection,
} = require("./coding-stack-anchor");
const {
  findReferences,
  buildRefsInjection,
  buildCallerBodyInjection,
} = require("./coding-find-refs");
const { getGenericHint, getSystemHintAppendix } = require("./coding-gen-hints");
const {
  createD2State,
  classifyVerifyFailure,
  tryOpenD2Cycle,
  evaluateD2Tool,
  applyD2Advance,
  buildGateUserMessage,
  d2Summary,
  normalizeHypothesis,
} = require("./coding-d2-retry");
const {
  createDiversityState,
  evaluateDiversityPlan,
  evaluateDiversityPatch,
  recordFailedPath,
  lastFailedPath,
  buildDiversityGateExtra,
  diversitySummary,
  writeCycleHypothesis,
  writeCyclePatch,
  writeCycleVerify,
  noteCycleMetrics,
  jaccardPatch,
  sameFileSet,
} = require("./coding-d2-diversity");
const {
  createFeedbackPackState,
  applyFeedbackPack,
  noteReadOfFullLog,
  notePlanAfterFeedback,
  notePatchAfterFeedback,
  noteStackAnchor,
  feedbackPackSummary,
} = require("./coding-feedback-pack");
const {
  createFeedbackConsumeState,
  noteVerifyFailure,
  submitConsumption,
  consumeBlocksApply,
  notePlanBinding,
  notePatchBinding,
  feedbackConsumeSummary,
  buildConsumeGateUserMessage,
} = require("./coding-feedback-consume");
const {
  createEvidencePatchBindState,
  noteVerifyFailureForBind,
  noteApplyAttempt,
  checkApplyBindingGate,
  submitPatchBinding,
  notePatchAfterBinding,
  evidencePatchBindSummary,
  buildEpbGateUserMessage,
} = require("./coding-evidence-patch-bind");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildSystemPrompt() {
  const lines = [
    "You are MOGU's unattended coding worker for a real git repository.",
    "Fix the issue with the smallest correct production-code change.",
    "Workflow: set_plan → grep/search → read → apply_patch → run_tests → on failure rollback + revise plan.",
    "Rules:",
    "- ALWAYS call set_plan before the first apply_patch (and again when strategy changes).",
    "- Prefer grep for symbols/regex; use search for filename discovery.",
    "- Prefer implementation modules; do not edit tests/fixtures unless the bug is in the harness.",
    "- No unrelated refactors; no monkey-patching unrelated modules.",
    "- SEARCH must match file text exactly (including indentation).",
    "- apply_patch auto-checkpoints; if tests fail badly, rollback to last or head, then re-plan.",
    "- Stop when tests pass (or report done if no verify stages).",
    "Use tools via function calls only. Do not pretend you edited without apply_patch.",
  ];
  // integrity_v1: always-on universal checklist (no gold / no instance names).
  const appendix = getSystemHintAppendix();
  if (appendix) {
    lines.push("", appendix);
  }
  return lines.join("\n");
}

async function chatWithTools({
  model,
  messages,
  tools,
  baseUrl,
  apiKey,
  timeoutMs = 180_000,
}) {
  const root = String(baseUrl || process.env.OPENAI_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  const key = String(apiKey || process.env.OPENAI_API_KEY || process.env.MOGU_API_KEY || "").trim();
  if (!root) throw new Error("缺少 OPENAI_BASE_URL");
  if (!key) throw new Error("缺少 API Key");
  const maxTries = Math.max(1, Number(process.env.MOGU_RELAY_RETRIES || 8) || 8);
  let lastErr = null;
  for (let tryNo = 1; tryNo <= maxTries; tryNo += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${root}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: "auto",
          temperature: 0.1,
          max_tokens: 4096,
          // GPT-5.6 (manylisten / OpenAI-compat): tool_calls require reasoning_effort=none
          ...(/gpt-5\.6|gpt-5\.5|o3|o4/i.test(String(model || ""))
            ? { reasoning_effort: "none" }
            : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`OpenAI-compat HTTP ${res.status}: ${body.slice(0, 300)}`);
        err.status = res.status;
        if ([429, 502, 503, 504].includes(res.status) && tryNo < maxTries) {
          lastErr = err;
          await sleep(Math.min(60_000, 2500 * 2 ** (tryNo - 1)));
          continue;
        }
        throw err;
      }
      const data = await res.json();
      const msg = data?.choices?.[0]?.message || {};
      return {
        content: String(msg.content || ""),
        toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
        raw: msg,
      };
    } catch (error) {
      lastErr = error;
      const transient =
        error?.name === "AbortError" ||
        /ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(String(error?.message || error));
      if (transient && tryNo < maxTries) {
        await sleep(Math.min(60_000, 2500 * 2 ** (tryNo - 1)));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("OpenAI-compat tools chat failed");
}

function parseToolArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw || "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function shouldUseCodingAgent(settings = {}, args = {}) {
  if (args.codingAgent === false) return false;
  if (process.env.MOGU_CODING_AGENT === "0") return false;
  if (args.codingAgent === true || process.env.MOGU_CODING_AGENT === "1") return true;
  // Default on for cloud OpenAI-compatible brains (unattended worker path).
  const base = String(settings.agentApiBaseUrl || process.env.OPENAI_BASE_URL || "").trim();
  const key = String(
    process.env.OPENAI_API_KEY || process.env.MOGU_API_KEY || settings.agentApiKey || ""
  ).trim();
  const ollama =
    settings.codingUseOllama === true ||
    String(settings.agentApiPreset || "").toLowerCase() === "ollama" ||
    process.env.MOGU_USE_OLLAMA === "1" ||
    /11434/.test(base);
  if (ollama) return false;
  if (process.env.MOGU_CLOUD_PATCH === "1") return true;
  return Boolean(base && key && !/11434/.test(base));
}

/**
 * @param {{
 *   workspace: string,
 *   prompt: string,
 *   model?: string,
 *   allowPaths?: string[],
 *   verifyCommand?: string,
 *   verifyStages?: Array<{name?: string, command: string}>,
 *   dockerImage?: string,
 *   dockerStrict?: boolean,
 *   dockerSwe?: boolean,
 *   baseUrl?: string,
 *   apiKey?: string,
 *   timeoutMs?: number,
 *   maxSteps?: number,
 *   structuredRetry?: boolean,
 *   structuredRetryMaxCycles?: number,
 *   hypothesisDiversity?: boolean,
 *   diversityJaccardMax?: number,
 *   cycleArtifactDir?: string,
 * }} opts
 */
async function runCodingAgentLoop({
  workspace,
  prompt,
  model = "gpt-5.6-sol",
  allowPaths = [],
  verifyCommand = "",
  verifyStages = null,
  dockerImage = "",
  dockerStrict = false,
  dockerSwe = false,
  baseUrl = "",
  apiKey = "",
  timeoutMs = 480_000,
  maxSteps = 24,
  instanceId = "",
  structuredRetry = undefined,
  structuredRetryMaxCycles = undefined,
  hypothesisDiversity = undefined,
  diversityJaccardMax = undefined,
  cycleArtifactDir = undefined,
  feedbackPack = undefined,
  feedbackPackDir = undefined,
  feedbackConsume = undefined,
  feedbackConsumeDir = undefined,
  evidencePatchBind = undefined,
  evidencePatchBindDir = undefined,
} = {}) {
  const ws = String(workspace || "").trim();
  if (!ws) {
    return { ok: false, error: "工作区不存在", code: "workspace_missing", engine: "coding_agent" };
  }

  const image = String(dockerImage || process.env.MOGU_VERIFY_DOCKER_IMAGE || "").trim();
  const strict =
    Boolean(dockerStrict) ||
    process.env.MOGU_DOCKER_VERIFY_STRICT === "1" ||
    process.env.MOGU_SWE_DOCKER_VERIFY === "1";
  const swe =
    Boolean(dockerSwe) ||
    process.env.MOGU_VERIFY_DOCKER_SWE === "1" ||
    /sweb\.eval\./i.test(image);
  const runner = createCodingToolRunner({
    workspace: ws,
    allowPaths,
    verifyCommand,
    verifyStages,
    dockerImage: image,
    dockerStrict: strict,
    dockerSwe: swe,
    requirePlan: true,
  });
  const stages = normalizeVerifyStages(verifyCommand, verifyStages);
  const started = Date.now();
  const stepCap = Math.min(40, Math.max(4, Number(maxSteps) || 24));
  const messages = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: [
        "### Task",
        String(prompt || "").trim(),
        "",
        stages.length
          ? `### Verify stages\n${stages.map((s) => `- ${s.name}: ${s.command}`).join("\n")}`
          : "### Verify stages\n(none — still make a minimal correct fix)",
        "",
        image
          ? `### Docker verify\nimage=${image}\nmode=${swe ? "swe-official" : "docker"}\nstrict=${strict}\nTreat test failures as real. Do not assume success on missing deps.`
          : "",
        "",
        "Start with set_plan after a quick grep/search of implementation symbols, then read and patch.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const trace = [];
  let steps = 0;
  let lastVerify = null;
  let appliedOnce = false;
  let stackAnchorUsed = false; // first verify-fail hard anchor only
  let findRefsUsed = false; // Phase 2: find_references after first fail
  let emptyPatchBoostUsed = false; // empty-tree escalate (may re-fire after rollback)
  let genHintUsed = false; // Phase 3: generic strategy hint once (no gold)
  const findRefsEnabled = process.env.MOGU_FIND_REFS !== "0";
  const instanceKey = String(instanceId || "").trim();
  const d2 = createD2State({ structuredRetry, structuredRetryMaxCycles });
  const div = createDiversityState({
    hypothesisDiversity,
    diversityJaccardMax,
    cycleArtifactDir,
  });
  const fb = createFeedbackPackState({ feedbackPack, feedbackPackDir });
  const fc = createFeedbackConsumeState({ feedbackConsume, feedbackConsumeDir });
  const epb = createEvidencePatchBindState({ evidencePatchBind, evidencePatchBindDir });
  // Diversity only meaningful on top of D2 structured retry.
  if (div.enabled && !d2.enabled) {
    div.enabled = false;
    trace.push("step0: d2_diversity_ignored (structured retry off)");
  }
  if (d2.enabled) {
    trace.push(`step0: d2_structured_retry maxCycles=${d2.maxCycles}`);
  }
  if (div.enabled) {
    trace.push(
      `step0: d2_hypothesis_diversity jaccardMax=${div.jaccardMax} artifacts=${div.artifactDir || "(none)"}`
    );
  }
  if (fb.enabled) {
    trace.push(
      `step0: feedback_pack artifacts=${fb.artifactDir || "(none)"} (presentation only; D2/D2′ off expected)`
    );
  }
  if (fc.enabled) {
    if (!fb.enabled) {
      // Spec: pack is base; still allow gate but warn — fingerprint weaker without pack.
      trace.push("step0: feedback_consume ON but feedback_pack OFF (base expected)");
    } else {
      trace.push(
        `step0: feedback_consume gate artifacts=${fc.artifactDir || "(none)"} (delta; C3/C4 required for util)`
      );
    }
  }
  if (epb.enabled) {
    if (fb.enabled || fc.enabled || d2.enabled || div.enabled) {
      trace.push(
        "step0: evidence_patch_bind ON with other strategy flags — Spec expects clean base (warn)"
      );
    }
    trace.push(
      `step0: evidence_patch_bind gate artifacts=${epb.artifactDir || "(none)"} (DB0–DB4; no fallback)`
    );
  }
  if (getSystemHintAppendix()) {
    genHintUsed = true;
    trace.push("step0: system_hint_appendix integrity_or_profile");
  }

  const gateUserText = () => {
    const parts = [];
    if (d2.active) {
      parts.push(buildGateUserMessage(d2.active));
      parts.push(buildDiversityGateExtra(div));
    }
    if (fc.enabled) parts.push(buildConsumeGateUserMessage(fc));
    if (epb.enabled) parts.push(buildEpbGateUserMessage(epb));
    return parts.filter(Boolean).join("\n\n");
  };

  const snapshotFailedPath = (cycleHint) => {
    if (!div.enabled) return null;
    const plan = runner.getPlan();
    const patch = typeof runner.getGitDiff === "function" ? runner.getGitDiff() : "";
    const files =
      typeof runner.getTouchedFiles === "function" ? runner.getTouchedFiles() : [];
    const hyp = plan?.hypothesis || "";
    const last = lastFailedPath(div);
    if (
      last &&
      normalizeHypothesis(last.hypothesis) === normalizeHypothesis(hyp) &&
      last.patch === patch
    ) {
      return last;
    }
    return recordFailedPath(div, {
      hypothesis: hyp,
      files,
      patch,
      cycle: cycleHint,
    });
  };

  const openD2AfterFailure = (verifyOut) => {
    if (!d2.enabled) return false;
    if (d2.active) return false;
    snapshotFailedPath(d2.cyclesCompleted);
    const classification = classifyVerifyFailure(verifyOut);
    const prevHyp = runner.getPlan()?.hypothesis || "";
    const opened = tryOpenD2Cycle(d2, classification, prevHyp);
    if (opened) {
      trace.push(
        `step${steps}: d2_gate_open cycle=${d2.active.cycle} class=${classification.class}${div.enabled ? " diversity=1" : ""}`
      );
    }
    return opened;
  };

  while (steps < stepCap && Date.now() - started < timeoutMs) {
    steps += 1;
    let reply;
    try {
      reply = await chatWithTools({
        model,
        messages,
        tools: runner.defs,
        baseUrl,
        apiKey,
        timeoutMs: Math.min(180_000, timeoutMs),
      });
    } catch (error) {
      return {
        ok: false,
        error: error.message || String(error),
        code: "llm_failed",
        engine: "coding_agent",
        log: [...trace, `llm_error: ${error.message}`].join("\n"),
        attempts: steps,
        focusPaths: runner.getPlan()?.target_files || [],
        toolsUsed: runner.getUsed(),
        agentSteps: steps,
      };
    }

    if (!reply.toolCalls.length) {
      // Model stopped without tools — accept if dirty and verify ok/skipped/env
      const dirty = runner.isDirty();
      if (d2.active) {
        messages.push({
          role: "assistant",
          content: reply.content || "",
        });
        messages.push({
          role: "user",
          content: truncateUser(gateUserText()),
        });
        trace.push(`step${steps}: d2_gate_block_finish phase=${d2.active.phase}`);
        continue;
      }
      if (!dirty) {
        messages.push({
          role: "assistant",
          content: reply.content || "",
        });
        messages.push({
          role: "user",
          content:
            "No file changes yet. Use set_plan → grep/read → apply_patch. Do not finish without a real code change.",
        });
        trace.push(`step${steps}: no_tools_no_diff`);
        continue;
      }
      if (stages.length) {
        lastVerify = runVerifyWithOptionalDocker(ws, stages, {
          timeoutMs: 300_000,
          dockerImage: image,
          dockerStrict: strict,
          dockerSwe: swe,
        });
        const softEnv = lastVerify.kind === "env" && !strict;
        if (!lastVerify.ok && !softEnv) {
          messages.push({ role: "assistant", content: reply.content || "done?" });
          const opened = openD2AfterFailure(
            `ok=false failedStage=${lastVerify.failedStage || "-"} kind=${lastVerify.kind}\n${lastVerify.log || ""}`
          );
          messages.push({
            role: "user",
            content: truncateUser(
              opened && d2.active
                ? `${gateUserText()}\n\n${lastVerify.log || ""}`
                : `Verify still failing (${lastVerify.failedStage}, kind=${lastVerify.kind}). Use rollback if needed, revise set_plan, continue with tools.\n${lastVerify.log || ""}`
            ),
          });
          trace.push(`step${steps}: stopped_but_verify_failed`);
          continue;
        }
      }
      trace.push(`step${steps}: finished_text`);
      break;
    }

    messages.push({
      role: "assistant",
      content: reply.content || null,
      tool_calls: reply.toolCalls,
    });

    for (const call of reply.toolCalls) {
      const name = call?.function?.name || call?.name || "";
      const args = parseToolArgs(call?.function?.arguments || call?.arguments);

      // B2-D2 pre-gate: block disallowed tools before execute.
      if (d2.active) {
        const pre = evaluateD2Tool(d2.active, name, {
          hypothesis: String(args.hypothesis || ""),
          applyOk: false,
          verifyOk: false,
        });
        if (!pre.allow) {
          d2.blockedToolCount += 1;
          const blocked = pre.error || "B2-D2 gate blocked tool";
          trace.push(`step${steps}: d2_block ${name} phase=${d2.active.phase}`);
          messages.push({
            role: "tool",
            tool_call_id: call.id || `call_${steps}_${name}`,
            content: `ERROR: ${blocked}`,
          });
          messages.push({
            role: "user",
            content: truncateUser(gateUserText()),
          });
          continue;
        }
        if (div.enabled && name === "set_plan" && d2.active.phase === "need_plan") {
          const divPlan = evaluateDiversityPlan(div, {
            hypothesis: String(args.hypothesis || ""),
            approach: String(args.approach || ""),
            candidate_hypotheses: args.candidate_hypotheses,
            targetFiles: args.target_files || [],
          });
          if (!divPlan.ok) {
            d2.blockedToolCount += 1;
            trace.push(`step${steps}: d2_diversity_block set_plan`);
            messages.push({
              role: "tool",
              tool_call_id: call.id || `call_${steps}_${name}`,
              content: `ERROR: ${divPlan.error}`,
            });
            messages.push({
              role: "user",
              content: truncateUser(gateUserText()),
            });
            continue;
          }
        }
      }

      // Feedback-Consumption: block apply_patch until valid §2.1 record for pending failure.
      if (name === "apply_patch" && consumeBlocksApply(fc)) {
        fc.gateBlocks += 1;
        trace.push(`step${steps}: feedback_consume_block apply_patch`);
        messages.push({
          role: "tool",
          tool_call_id: call.id || `call_${steps}_${name}`,
          content:
            "ERROR: FEEDBACK_CONSUME gate — call record_failure_consumption (valid §2.1 fields) before apply_patch.",
        });
        messages.push({
          role: "user",
          content: truncateUser(buildConsumeGateUserMessage(fc)),
        });
        continue;
      }

      // EPB: no binding fallback — BINDING_MISSING blocks apply_patch.
      if (name === "apply_patch" && epb.enabled) {
        const gate = checkApplyBindingGate(epb);
        if (!gate.allow) {
          trace.push(`step${steps}: epb_block ${gate.code}`);
          messages.push({
            role: "tool",
            tool_call_id: call.id || `call_${steps}_${name}`,
            content: `ERROR: ${gate.error}`,
          });
          messages.push({
            role: "user",
            content: truncateUser(buildEpbGateUserMessage(epb)),
          });
          continue;
        }
      }

      // Validate consumption record before tool echo.
      if (name === "record_failure_consumption") {
        const submitted = submitConsumption(fc, args);
        if (!submitted.ok) {
          trace.push(`step${steps}: feedback_consume_reject ${submitted.error}`);
          messages.push({
            role: "tool",
            tool_call_id: call.id || `call_${steps}_${name}`,
            content: `ERROR: ${submitted.error}`,
          });
          messages.push({
            role: "user",
            content: truncateUser(buildConsumeGateUserMessage(fc)),
          });
          continue;
        }
        trace.push(`step${steps}: feedback_consume_ok seq=${submitted.entry.seq} C2=1`);
      }

      if (name === "record_patch_binding") {
        const submitted = submitPatchBinding(epb, args);
        if (!submitted.ok) {
          trace.push(`step${steps}: epb_reject ${submitted.code} ${submitted.error}`);
          messages.push({
            role: "tool",
            tool_call_id: call.id || `call_${steps}_${name}`,
            content: `ERROR: ${submitted.error}`,
          });
          messages.push({
            role: "user",
            content: truncateUser(buildEpbGateUserMessage(epb)),
          });
          continue;
        }
        trace.push(
          `step${steps}: epb_binding_valid seq=${submitted.entry.seq} evidence=${submitted.entry.evidence_id}`
        );
      }

      let out = await runner.execute(name, args);
      if (name === "apply_patch" && /ok=true/.test(out)) appliedOnce = true;

      // Feedback-B: re-present failures only (presentation; not success noise).
      if (fb.enabled) {
        const raw = String(out || "");
        const shouldPack =
          raw.startsWith("ERROR:") ||
          raw.startsWith("NO_VERIFY") ||
          (name === "run_tests" && !/\bok=true\b/.test(raw));
        if (shouldPack) {
          const packed = applyFeedbackPack(fb, out, { toolName: name });
          out = packed.out;
          if (packed.pack) {
            trace.push(
              `step${steps}: feedback_pack seq=${packed.pack.meta.seq} class=${packed.pack.meta.failure_class} template=${packed.pack.meta.template}`
            );
            if (
              fc.enabled &&
              name === "run_tests" &&
              packed.pack.meta.template !== "infra_failure"
            ) {
              noteVerifyFailure(fc, packed.pack.meta, packed.fullText || out);
              trace.push(`step${steps}: feedback_consume_pending`);
            }
          }
        }
      } else if (
        fc.enabled &&
        name === "run_tests" &&
        !/\bok=true\b/.test(String(out || "")) &&
        !String(out || "").startsWith("NO_VERIFY")
      ) {
        noteVerifyFailure(
          fc,
          {
            failedStage: (/failedStage=([^\s]+)/.exec(out) || [])[1] || null,
            failure_class: "other",
          },
          out
        );
        trace.push(`step${steps}: feedback_consume_pending (no pack base)`);
      }

      // EPB: open Evidence Object on real verify fail (clean base; no pack required).
      if (
        epb.enabled &&
        name === "run_tests" &&
        !/\bok=true\b/.test(String(out || "")) &&
        !String(out || "").startsWith("NO_VERIFY")
      ) {
        const ev = noteVerifyFailureForBind(epb, out, {
          failedStage: (/failedStage=([^\s]+)/.exec(out) || [])[1] || null,
        });
        if (ev) {
          trace.push(`step${steps}: epb_evidence_open id=${ev.evidence_id}`);
        }
      }
      if (fb.enabled && name === "read") {
        const readPath = String(args.path || args.file_path || args.filePath || "");
        if (noteReadOfFullLog(fb, readPath)) {
          trace.push(`step${steps}: feedback_pack_read_full_log`);
        }
      }
      if (name === "set_plan" && /ok=true/.test(out)) {
        if (fb.enabled) notePlanAfterFeedback(fb, runner.getPlan() || args);
        if (fc.enabled) notePlanBinding(fc, runner.getPlan() || args);
      }
      if (name === "apply_patch" && /ok=true/.test(out) && runner.isDirty()) {
        const patch =
          typeof runner.getGitDiff === "function" ? runner.getGitDiff() : "";
        const files =
          typeof runner.getTouchedFiles === "function" ? runner.getTouchedFiles() : [];
        if (fb.enabled) notePatchAfterFeedback(fb, patch, files);
        if (fc.enabled && fc.lastValid) {
          const bound = notePatchBinding(fc, patch, files);
          if (bound) {
            trace.push(
              `step${steps}: feedback_consume_bound C3=${bound.C3} C4=${bound.C4} j=${bound.jaccard_vs_prev}`
            );
          }
        }
        if (epb.enabled) {
          const afterFail = Boolean(epb.evidences?.length);
          noteApplyAttempt(epb, { afterFail });
          if (epb.lastBinding) {
            const bound = notePatchAfterBinding(epb, patch, files);
            if (bound) {
              trace.push(
                `step${steps}: epb_bound DB2=${bound.DB2} L=${bound.DB2_level} DB4=${bound.DB4}`
              );
            }
          }
        }
      }

      // B2-D2 post-advance after successful gated actions.
      if (d2.active) {
        if (name === "set_plan" && /ok=true/.test(out)) {
          const hyp = String(args.hypothesis || runner.getPlan()?.hypothesis || "");
          const decision = evaluateD2Tool(d2.active, name, { hypothesis: hyp });
          applyD2Advance(d2, decision.advance, { hypothesis: hyp });
          if (decision.advance) {
            trace.push(`step${steps}: d2_advance ${decision.advance} via=set_plan`);
          }
          if (div.enabled) {
            const plan = runner.getPlan();
            writeCycleHypothesis(div.artifactDir, d2.active.cycle, {
              hypothesis: plan?.hypothesis || hyp,
              approach: plan?.approach || String(args.approach || ""),
              meta: div.lastPlanMeta,
            });
            d2.active.diversityPlan = div.lastPlanMeta;
          }
        } else if (name === "apply_patch") {
          const applyOk = /ok=true/.test(out) && runner.isDirty();
          if (applyOk && div.enabled && d2.active.phase === "need_patch") {
            const patch =
              typeof runner.getGitDiff === "function" ? runner.getGitDiff() : "";
            const files =
              typeof runner.getTouchedFiles === "function"
                ? runner.getTouchedFiles()
                : [];
            const divPatch = evaluateDiversityPatch(div, { files, patch });
            if (!divPatch.ok) {
              d2.blockedToolCount += 1;
              trace.push(
                `step${steps}: d2_diversity_block apply_patch jaccard=${divPatch.meta?.jaccard_patch}`
              );
              messages.push({
                role: "tool",
                tool_call_id: call.id || `call_${steps}_${name}`,
                content: `ERROR: ${divPatch.error}\nHINT: call rollback then set_plan with a different candidate path.`,
              });
              messages.push({
                role: "user",
                content: truncateUser(gateUserText()),
              });
              continue;
            }
            d2.active.diversityPatchMeta = divPatch.meta;
            d2.active.cyclePatch = patch;
            d2.active.cycleFiles = files;
            writeCyclePatch(div.artifactDir, d2.active.cycle, patch);
          }
          const decision = evaluateD2Tool(d2.active, name, { applyOk });
          applyD2Advance(d2, decision.advance);
          if (decision.advance) {
            trace.push(`step${steps}: d2_advance ${decision.advance} via=apply_patch`);
          }
        }
      }

      if (name === "run_tests") {
        lastVerify = {
          ok: /\bok=true\b/.test(out) || out.startsWith("NO_VERIFY"),
          kind: /kind=env/.test(out) ? "env" : /ok=true/.test(out) ? "ok" : "test",
          log: out,
          failedStage: (/failedStage=([^\s]+)/.exec(out) || [])[1] || null,
        };

        // Close or open D2 cycles around real verify outcomes.
        if (d2.active && d2.active.phase === "need_verify") {
          const cycleNum = d2.active.cycle;
          const decision = evaluateD2Tool(d2.active, name, { verifyOk: lastVerify.ok });
          if (div.enabled) {
            const prev = lastFailedPath(div);
            const curPatch =
              d2.active.cyclePatch ||
              (typeof runner.getGitDiff === "function" ? runner.getGitDiff() : "");
            const curFiles =
              d2.active.cycleFiles ||
              (typeof runner.getTouchedFiles === "function"
                ? runner.getTouchedFiles()
                : []);
            const j = prev?.patch != null ? jaccardPatch(curPatch, prev.patch) : null;
            const fileChanged = prev?.files?.length
              ? !sameFileSet(curFiles, prev.files)
              : null;
            writeCycleVerify(div.artifactDir, cycleNum, {
              ok: lastVerify.ok,
              kind: lastVerify.kind,
              failedStage: lastVerify.failedStage,
              advance: decision.advance || null,
              jaccard_patch_vs_prev_failed: j,
              file_set_changed: fileChanged,
              files: curFiles,
              hypothesis: runner.getPlan()?.hypothesis || "",
              log_tail: String(out || "").slice(-4000),
            });
            noteCycleMetrics(div, {
              cycle: cycleNum,
              verifyOk: lastVerify.ok,
              jaccard_patch: j,
              file_set_changed: fileChanged,
              hypothesis: runner.getPlan()?.hypothesis || "",
              files: curFiles,
              candidates_n: d2.active.diversityPlan?.candidate_hypotheses_n ?? null,
            });
          }
          applyD2Advance(d2, decision.advance);
          trace.push(`step${steps}: d2_advance ${decision.advance || "none"} via=run_tests`);
          if (decision.advance === "cycle_failed") {
            openD2AfterFailure(out);
          }
        } else if (
          !lastVerify.ok &&
          lastVerify.kind !== "env" &&
          !out.startsWith("NO_VERIFY")
        ) {
          openD2AfterFailure(out);
        }

        // First verify failure → stack-top hard anchor + Phase-2 find_references.
        // Empty-tree after rollback: separate boost (caller bodies), even if refs already ran.
        if (
          !lastVerify.ok &&
          lastVerify.kind !== "env" &&
          !out.startsWith("NO_VERIFY")
        ) {
          const emptyPatch = !runner.isDirty();
          const needAnchor = appliedOnce && !stackAnchorUsed;
          const needRefs = findRefsEnabled && !findRefsUsed && (appliedOnce || emptyPatch);
          const needEmptyBoost =
            findRefsEnabled && emptyPatch && !emptyPatchBoostUsed;
          const needGenHint = !genHintUsed && Boolean(getGenericHint(instanceKey));
          if (needAnchor || needRefs || needEmptyBoost || needGenHint) {
            const anchor = extractStackAnchor(out, { workspace: ws });
            const parts = [];
            if (anchor && needAnchor) {
              stackAnchorUsed = true;
              noteStackAnchor(fb, anchor);
              const start = Math.max(1, anchor.line - 30);
              const slice = await runner.execute("read", {
                path: anchor.path,
                start_line: start,
                max_lines: 80,
              });
              parts.push(buildAnchorInjection(anchor, slice));
              trace.push(`step${steps}: stack_anchor ${anchor.path}:${anchor.line}`);
            } else if (!anchor && needAnchor) {
              stackAnchorUsed = true;
              trace.push(`step${steps}: stack_anchor_skip`);
            }

            let refsResult = null;
            if (anchor && (needRefs || needEmptyBoost)) {
              if (needRefs) findRefsUsed = true;
              if (needEmptyBoost) emptyPatchBoostUsed = true;
              runner.allowFindRefs();
              const abs = path.join(ws, anchor.path);
              refsResult = findReferences({
                workspace: ws,
                file_path: abs,
                line: anchor.line,
                maxRefs: 12,
              });
              if (needRefs || needEmptyBoost) {
                parts.push(
                  buildRefsInjection({
                    file_path: anchor.path,
                    line: anchor.line,
                    result: refsResult,
                  })
                );
              }
              trace.push(
                `step${steps}: find_refs engine=${refsResult.engine} symbol=${refsResult.symbol || "-"} n=${(refsResult.refs || []).length}${needEmptyBoost ? " empty_boost" : ""}`
              );
              if (needEmptyBoost && (refsResult.refs || []).length) {
                const bodies = buildCallerBodyInjection(ws, refsResult.refs, {
                  maxBodies: 3,
                  pad: 30,
                });
                if (bodies) {
                  parts.push(bodies);
                  trace.push(`step${steps}: find_refs_empty_patch_bodies`);
                }
              }
            } else if (!anchor && (needRefs || needEmptyBoost)) {
              if (needRefs) findRefsUsed = true;
              if (needEmptyBoost) emptyPatchBoostUsed = true;
              runner.allowFindRefs();
              trace.push(`step${steps}: find_refs_skip_no_anchor`);
            }

            // Phase-3 generic hint: direction only — never gold lines/values.
            if (needGenHint) {
              const hint = getGenericHint(instanceKey);
              if (hint) {
                genHintUsed = true;
                parts.push(hint);
                trace.push(`step${steps}: gen_hint ${instanceKey}`);
              }
            }

            if (parts.length) {
              const injection = parts.join("\n\n");
              out = `${out.slice(0, 4500)}\n\n${injection}`.slice(0, 9000);
              messages.push({
                role: "tool",
                tool_call_id: call.id || `call_${steps}_${name}`,
                content: out,
              });
              const gateExtra = d2.active ? `\n\n${gateUserText()}` : "";
              messages.push({
                role: "user",
                content: truncateUser(
                  `${injection}\n\nBefore generating the next SEARCH/REPLACE, account for the caller list above. Use set_plan if strategy changes, then apply_patch. Do not emit an empty patch.${gateExtra}`
                ),
              });
              continue;
            }
          }
        }

        if (d2.active && (!lastVerify.ok || d2.active.phase !== "need_verify")) {
          // Ensure gate reminder after bare run_tests failure without anchor injection.
          messages.push({
            role: "tool",
            tool_call_id: call.id || `call_${steps}_${name}`,
            content: out.slice(0, 8000),
          });
          messages.push({
            role: "user",
            content: truncateUser(gateUserText()),
          });
          trace.push(`step${steps}: ${name}`);
          continue;
        }
      }
      trace.push(`step${steps}: ${name}`);
      messages.push({
        role: "tool",
        tool_call_id: call.id || `call_${steps}_${name}`,
        content: out.slice(0, 8000),
      });
      if (d2.active && name === "set_plan" && /ok=true/.test(out)) {
        messages.push({
          role: "user",
          content: truncateUser(gateUserText()),
        });
      }
      if (d2.active && name === "apply_patch" && /ok=true/.test(out) && runner.isDirty()) {
        messages.push({
          role: "user",
          content: truncateUser(gateUserText()),
        });
      }
    }

    // Early success: dirty + verify passed
    if (runner.isDirty() && stages.length && lastVerify?.ok) {
      trace.push(`step${steps}: verify_ok_early_exit`);
      break;
    }
    if (runner.isDirty() && !stages.length && appliedOnce) {
      // No verify configured — one successful apply is enough if model stops next turn
    }
  }

  const dirty = runner.isDirty();
  if (stages.length && dirty) {
    lastVerify = runVerifyWithOptionalDocker(ws, stages, {
      timeoutMs: 300_000,
      dockerImage: image,
      dockerStrict: strict,
      dockerSwe: swe,
    });
  }

  const softEnvOk = lastVerify?.kind === "env" && !strict;
  const verifySkipped =
    !stages.length || softEnvOk || lastVerify?.skipped
      ? softEnvOk
        ? "env"
        : true
      : null;
  const verifyOk = !stages.length
    ? null
    : softEnvOk
      ? null
      : Boolean(lastVerify?.ok);

  const failToPassOk =
    lastVerify?.results?.find((r) => /FAIL_TO_PASS/i.test(r.name))?.ok ??
    (stages.some((s) => /FAIL_TO_PASS/i.test(s.name))
      ? softEnvOk
        ? null
        : lastVerify?.ok
      : null);
  const passToPassOk =
    lastVerify?.results?.find((r) => /PASS_TO_PASS/i.test(r.name))?.ok ?? null;

  // Strict docker: never celebrate env/infra soft-skips as success.
  const ok =
    dirty &&
    (verifyOk === true ||
      (!strict && (verifyOk == null || softEnvOk)) ||
      (!stages.length && dirty));

  const plan = runner.getPlan();

  return {
    ok,
    error: ok
      ? null
      : !dirty
        ? "未产生有效改动"
        : lastVerify && !lastVerify.ok && lastVerify.kind !== "env"
          ? lastVerify.error || "verify failed"
          : "coding agent 未完成",
    code: ok ? undefined : dirty ? "verify_failed" : "apply_failed",
    engine: "coding_agent",
    command: `openai:${model} → coding_agent`,
    log: trace.join("\n").slice(-4000),
    model,
    mode: "agent_tools",
    attempts: steps,
    agentSteps: steps,
    toolsUsed: runner.getUsed(),
    focusPaths: plan?.target_files || [],
    plan,
    checkpoints: runner.getCheckpoints(),
    stackAnchorUsed,
    findRefsUsed,
    emptyPatchBoostUsed,
    genHintUsed,
    instanceId: instanceKey || null,
    d2Retry: d2Summary(d2),
    d2Diversity: diversitySummary(div),
    feedbackPack: feedbackPackSummary(fb),
    feedbackConsume: feedbackConsumeSummary(fc),
    evidencePatchBind: evidencePatchBindSummary(epb),
    verifyOk,
    verifySkipped,
    failToPassOk,
    passToPassOk,
    verifyStages: (lastVerify?.results || []).map((r) => ({
      name: r.name,
      ok: r.ok,
      kind: r.kind,
      command: r.command,
    })),
  };
}

function truncateUser(s) {
  const t = String(s || "");
  return t.length > 3500 ? `${t.slice(0, 3500)}\n...[truncated]` : t;
}

module.exports = {
  runCodingAgentLoop,
  shouldUseCodingAgent,
  buildSystemPrompt,
  chatWithTools,
};

// Re-export helpers for unit tests / smoke.
module.exports.d2 = require("./coding-d2-retry");
module.exports.d2Diversity = require("./coding-d2-diversity");
module.exports.feedbackPack = require("./coding-feedback-pack");
module.exports.feedbackConsume = require("./coding-feedback-consume");
module.exports.evidencePatchBind = require("./coding-evidence-patch-bind");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { RunEventStore } = require("../src/main/moguai/runtime/run-event-store");
const { RetryExecutor } = require("../src/main/moguai/runtime/retry-executor");
const { SubtaskCoordinator } = require("../src/main/moguai/runtime/subtask-coordinator");
const { PermissionGrants } = require("../src/main/permission-grants");
const { TaskStore } = require("../src/main/task-store");

async function tempRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("run event store dedupes, sequences, redacts, and replays summaries", async () => {
  const root = await tempRoot("mogu-events-");
  const clock = () => new Date("2026-07-24T00:00:00.000Z");
  const store = new RunEventStore(root, { clock });
  const first = await store.append("task-1", {
    eventId: "evt-1",
    type: "coding.trace",
    source: "coding",
    payload: { token: "secret", nested: { apiKey: "hidden", safe: "yes" } },
  });
  const duplicate = await store.append("task-1", {
    eventId: "evt-1",
    type: "ignored",
    payload: { safe: "no" },
  });
  assert.equal(first.event.sequence, 1);
  assert.equal(duplicate.deduped, true);
  assert.equal(duplicate.event.type, "coding.trace");
  assert.equal(first.event.payload.token, "[REDACTED]");
  assert.equal(first.event.payload.nested.apiKey, "[REDACTED]");
  const replayed = await store.replay("task-1", (count) => count + 1, 0);
  assert.equal(replayed.state, 1);
  assert.equal(replayed.summary.eventCount, 1);
});

test("run event store rejects path escape and fails closed on corruption", async () => {
  const root = await tempRoot("mogu-events-");
  const store = new RunEventStore(root);
  await assert.rejects(() => store.append("../escape", { type: "x" }), { code: "invalid_task_id" });
  await store.append("task-safe", { eventId: "one", type: "started" });
  await fs.appendFile(path.join(root, "task-safe", "events.jsonl"), "{broken\n");
  const read = await store.read("task-safe");
  assert.equal(read.corruption.line, 2);
  await assert.rejects(() => store.append("task-safe", { eventId: "two", type: "next" }), {
    code: "event_log_corrupt",
  });
});

test("permission leases enforce expiry, scope, budget, revoke, and L3 denial", async () => {
  const root = await tempRoot("mogu-leases-");
  let now = Date.parse("2026-07-24T00:00:00.000Z");
  const grants = new PermissionGrants(path.join(root, "grants.json"), { clock: () => new Date(now) });
  const issued = await grants.issue({
    runId: "run-1",
    tool: "mogu.coding",
    scopes: ["repo.read.*"],
    riskLevel: 2,
    ttlMs: 1_000,
    maxUses: 1,
  });
  assert.equal(issued.ok, true);
  const base = {
    leaseId: issued.lease.id,
    runId: "run-1",
    tool: "mogu.coding",
    scope: "repo.read.files",
    riskLevel: 2,
  };
  assert.equal((await grants.check(base)).allowed, true);
  assert.equal((await grants.check({ ...base, scope: "repo.write" })).reason, "scope_denied");
  assert.equal((await grants.check({ ...base, riskLevel: 3 })).reason, "l3_confirmation_required");
  assert.equal((await grants.consume(base)).allowed, true);
  assert.equal((await grants.check(base)).reason, "budget_exhausted");
  await grants.revoke(issued.lease.id);
  assert.equal((await grants.check(base)).reason, "lease_revoked");

  const expiring = await grants.issue({ runId: "run-2", scope: "*", riskLevel: 1, ttlMs: 10 });
  now += 11;
  assert.equal((await grants.check({
    leaseId: expiring.lease.id,
    runId: "run-2",
    scope: "anything",
    riskLevel: 1,
  })).reason, "lease_expired");
  assert.equal((await grants.prune()).pruned, 2);
});

async function retryFixture(options = {}) {
  const root = await tempRoot("mogu-retry-");
  const eventStore = new RunEventStore(path.join(root, "events"));
  const taskStore = new TaskStore(path.join(root, "tasks.json"), { eventStore });
  const calls = [];
  const retry = new RetryExecutor({
    taskStore,
    eventStore,
    maxAttempts: options.maxAttempts || 3,
    baseBackoffMs: 0,
    sleep: async () => {},
    permissionCheck: async () => ({ allowed: true }),
    executor: async (input) => {
      calls.push(input);
      return options.executor ? options.executor(input) : { ok: true, summary: "done" };
    },
  });
  return { taskStore, eventStore, retry, calls };
}

test("retry never resubmits Gateway-accepted work", async () => {
  const { taskStore, retry, calls } = await retryFixture();
  const task = await taskStore.create({
    source: "openclaw",
    status: "failed",
    requestAcceptedByGateway: true,
    replay: { kind: "openclaw.send", text: "hello" },
  });
  const result = await retry.execute(task.moguTaskId);
  assert.equal(result.reason, "gateway_accepted_no_resubmit");
  assert.equal(calls.length, 0);
  assert.equal((await taskStore.list()).length, 1);
});

test("retry is idempotent and checkpoints before bounded attempts", async () => {
  let failures = 0;
  const { taskStore, eventStore, retry, calls } = await retryFixture({
    maxAttempts: 2,
    executor: async () => {
      failures += 1;
      if (failures < 2) throw new Error("transient");
      return { ok: true, summary: "recovered" };
    },
  });
  const parent = await taskStore.create({
    source: "coding",
    status: "failed",
    replay: { kind: "skill.mogu.coding.run", payload: { prompt: "x" } },
  });
  const first = await retry.execute(parent.moguTaskId, { idempotencyKey: "retry-key" });
  const second = await retry.execute(parent.moguTaskId, { idempotencyKey: "retry-key" });
  assert.equal(first.ok, true);
  assert.equal(first.attempts, 2);
  assert.equal(second.deduped, true);
  assert.equal(calls.length, 2);
  const events = await eventStore.read(first.task.moguTaskId);
  const types = events.events.map((event) => event.type);
  assert.deepEqual(types.filter((type) => type === "retry.checkpoint"), ["retry.checkpoint", "retry.checkpoint"]);
  assert.equal(types.at(-1), "retry.succeeded");
});

test("retry stops after configured attempt bound", async () => {
  const { taskStore, retry, calls } = await retryFixture({
    maxAttempts: 2,
    executor: async () => {
      throw new Error("always");
    },
  });
  const parent = await taskStore.create({
    source: "coding",
    status: "failed",
    replay: { kind: "skill.mogu.coding.run", payload: {} },
  });
  const result = await retry.execute(parent.moguTaskId);
  assert.equal(result.reason, "attempts_exhausted");
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
  assert.equal(result.task.status, "failed");
});

test("subtask coordinator joins at most two read-only worktrees", async () => {
  const root = await tempRoot("mogu-subtasks-");
  const eventStore = new RunEventStore(path.join(root, "events"));
  let active = 0;
  let peak = 0;
  const removed = [];
  const manager = {
    async add() {
      active += 1;
      peak = Math.max(peak, active);
      return { id: `wt-${active}-${Date.now()}`, path: root, readOnly: true };
    },
    assertCapability(capability) {
      if (!["read", "search", "test"].includes(capability)) throw new Error("forbidden");
    },
    async remove(id) {
      removed.push(id);
      active -= 1;
    },
  };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started = 0;
  const coordinator = new SubtaskCoordinator({
    worktreeManager: manager,
    eventStore,
    executor: async ({ subtask }) => {
      started += 1;
      if (started === 2) release();
      await gate;
      return { ok: true, id: subtask.id };
    },
  });
  const joined = await coordinator.join("task-parallel", [
    { id: "a", capabilities: ["read"] },
    { id: "b", capabilities: ["search"] },
  ], { joinId: "join-1" });
  assert.equal(joined.ok, true);
  assert.equal(peak, 2);
  assert.equal(removed.length, 2);
  await assert.rejects(() => coordinator.join("task-too-many", [{ id: "a" }, { id: "b" }, { id: "c" }]), {
    code: "parallel_limit",
  });
  await assert.rejects(() => coordinator.join("task-write", [{ id: "a", capabilities: ["write"] }]), {
    code: "read_only",
  });
});

test("subtask recovery identifies and resumes checkpointed join", async () => {
  const root = await tempRoot("mogu-subtasks-");
  const eventStore = new RunEventStore(path.join(root, "events"));
  await eventStore.append("task-recover", {
    eventId: "join-r:join",
    type: "subtasks.join.checkpoint",
    source: "subtask-coordinator",
    payload: { joinId: "join-r", subtasks: [{ id: "read", capabilities: ["read"], payload: {} }] },
  });
  const manager = {
    async add() { return { id: "wt-r", path: root, readOnly: true }; },
    assertCapability() { return true; },
    async remove() {},
  };
  let executions = 0;
  const coordinator = new SubtaskCoordinator({
    worktreeManager: manager,
    eventStore,
    executor: async () => {
      executions += 1;
      return { ok: true };
    },
  });
  const pending = await coordinator.recover("task-recover");
  assert.equal(pending.pending.length, 1);
  const resumed = await coordinator.recover("task-recover", { resume: true });
  assert.equal(resumed.resumed[0].ok, true);
  assert.equal(executions, 1);
  assert.equal((await coordinator.recover("task-recover")).pending.length, 0);
});

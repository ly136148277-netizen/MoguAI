const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { TaskStore, SCHEMA_VERSION } = require("../src/main/task-store");
const { toPublicTask, toPublicTaskPage } = require("../src/main/task-public");

async function tempStore(name = "mogu-a301-") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), name));
  const file = path.join(dir, "tasks.json");
  return { dir, file, store: new TaskStore(file) };
}

test("schema v1 migrates to v2 on load", async () => {
  const { file, store } = await tempStore();
  await fs.writeJson(file, {
    schemaVersion: 1,
    tasks: [
      {
        moguTaskId: "task-legacy-1",
        source: "pai",
        name: "旧任务",
        status: "running",
        promptId: "p-old",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  const row = await store.get("task-legacy-1");
  assert.ok(row);
  assert.equal(row.source, "pai");
  assert.equal(row.promptId, "p-old");
  assert.equal(typeof row.revision, "number");
  assert.ok(Array.isArray(row.eventIds));
  assert.equal(row.acceptance, "unknown");

  const disk = await fs.readJson(file);
  assert.equal(disk.schemaVersion, SCHEMA_VERSION);
  assert.equal(disk.tasks[0].moguTaskId, "task-legacy-1");
});

test("idempotencyKey create and eventId update do not duplicate", async () => {
  const { store } = await tempStore();
  const a = await store.create({
    source: "openclaw",
    name: "一次",
    idempotencyKey: "send:abc",
    status: "queued",
  });
  const b = await store.create({
    source: "openclaw",
    name: "二次",
    idempotencyKey: "send:abc",
    status: "queued",
  });
  assert.equal(a.moguTaskId, b.moguTaskId);
  assert.equal((await store.list()).length, 1);

  const first = await store.update(a.moguTaskId, {
    status: "running",
    runId: "run-1",
    eventId: "run-1:seq:1",
    eventSeq: 1,
  });
  const again = await store.update(a.moguTaskId, {
    status: "running",
    logSummary: "should ignore",
    eventId: "run-1:seq:1",
    eventSeq: 1,
  });
  assert.equal(again.revision, first.revision);
  assert.notEqual(again.logSummary, "should ignore");

  const stale = await store.update(a.moguTaskId, {
    status: "running",
    eventId: "run-1:seq:0",
    eventSeq: 0,
  });
  assert.equal(stale.revision, first.revision);
});

test("terminal status resists wrong reopen from duplicate events", async () => {
  const { store } = await tempStore();
  const task = await store.create({
    source: "comfy",
    name: "出图",
    status: "running",
    promptId: "p1",
  });
  await store.update(task.moguTaskId, {
    status: "succeeded",
    eventId: "p1:terminal:succeeded",
  });
  const reopened = await store.update(task.moguTaskId, {
    status: "running",
    eventId: "p1:delta:late",
  });
  assert.equal(reopened.status, "succeeded");
  assert.ok(reopened.terminalAt);
});

test("restart reload keeps single task and status", async () => {
  const { file } = await tempStore();
  const store1 = new TaskStore(file);
  const created = await store1.create({
    source: "studio",
    name: "创作",
    status: "running",
    promptId: "px",
    replay: { kind: "studio.run", payload: { tool: "none" } },
  });
  await store1.update(created.moguTaskId, {
    status: "failed",
    errorMessage: "boom",
    eventId: "px:terminal:failed",
  });

  const store2 = new TaskStore(file);
  const page = await store2.listPage({ sources: ["studio"], statuses: ["failed"] });
  assert.equal(page.total, 1);
  assert.equal(page.tasks[0].moguTaskId, created.moguTaskId);
  assert.equal(page.tasks[0].status, "failed");
  assert.equal(page.schemaVersion, SCHEMA_VERSION);
});

test("pagination cursor and source filter", async () => {
  const { store } = await tempStore();
  let clock = Date.parse("2026-07-01T00:00:00.000Z");
  store.clock = () => new Date(clock);
  for (let i = 0; i < 5; i += 1) {
    clock += 1000;
    await store.create({
      source: i % 2 === 0 ? "openclaw" : "pai",
      name: `t-${i}`,
      status: "queued",
      moguTaskId: `task-${i}`,
    });
  }
  const page1 = await store.listPage({ limit: 2, sources: ["openclaw"] });
  assert.equal(page1.tasks.length, 2);
  assert.equal(page1.hasMore, true);
  assert.ok(page1.nextCursor);
  const page2 = await store.listPage({ limit: 2, sources: ["openclaw"], cursor: page1.nextCursor });
  assert.ok(page2.tasks.length >= 1);
  const ids = new Set([...page1.tasks, ...page2.tasks].map((t) => t.moguTaskId));
  assert.equal(ids.size, page1.tasks.length + page2.tasks.length);
});

test("retry creates child task from replay without mutating parent", async () => {
  const { store } = await tempStore();
  const parent = await store.create({
    source: "openclaw",
    name: "对话",
    status: "failed",
    requestText: "你好",
    replay: { kind: "openclaw.send", text: "你好", sessionKey: "s1" },
  });
  assert.equal(parent.status, "failed");
  assert.ok(parent.terminalAt);
  const child = await store.retry(parent.moguTaskId);
  assert.ok(child);
  assert.equal(child.retryOf, parent.moguTaskId);
  assert.equal(child.status, "queued");
  assert.equal(child.replay.kind, "openclaw.send");
  const again = await store.retry(parent.moguTaskId);
  assert.equal(again.moguTaskId, child.moguTaskId);

  const parentAfter = await store.get(parent.moguTaskId);
  assert.equal(parentAfter.status, "failed");
});

test("public task payload never includes token-like fields", () => {
  const publicTask = toPublicTask({
    moguTaskId: "t1",
    source: "openclaw",
    status: "running",
    token: "secret-token",
    auth: { token: "x" },
    replay: { kind: "openclaw.send", text: "hi", apiKey: "k" },
  });
  const json = JSON.stringify(publicTask);
  assert.equal(json.includes("secret-token"), false);
  assert.equal(json.includes("apiKey"), false);
  assert.equal(publicTask.moguTaskId, "t1");

  const page = toPublicTaskPage({
    schemaVersion: 2,
    tasks: [publicTask],
    nextCursor: null,
    hasMore: false,
    total: 1,
    limit: 100,
  });
  assert.equal(page.ok, true);
  assert.equal(page.tasks.length, 1);
});

test("unified sources normalize unknown and comfy aliases", async () => {
  const { store } = await tempStore();
  const row = await store.create({ source: "Comfy", name: "x", status: "queued" });
  assert.equal(row.source, "comfy");
  const bad = await store.create({ source: "weird", name: "y", status: "queued" });
  assert.equal(bad.source, "unknown");
});

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");

const { ChatSessionStore, deriveTitle, exportSessionToMarkdown } = require("../src/main/chat-sessions");

describe("ChatSessionStore", () => {
  let storeDir;
  let store;

  before(async () => {
    storeDir = path.join(os.tmpdir(), `chat-sessions-${Date.now()}`);
    store = new ChatSessionStore(storeDir);
    await store.initialize();
  });

  after(async () => {
    await fs.remove(storeDir);
  });

  it("creates session and auto titles from first user message", async () => {
    const session = await store.create({
      modelId: "demo",
      modelName: "Demo",
      ollamaName: "demo",
      systemPrompt: "你是助手",
    });

    await store.appendMessage(session.id, { role: "user", content: "帮我写一个快速排序" });
    const updated = await store.get(session.id);
    assert.match(updated.title, /快速排序/);
  });

  it("searches sessions by title and preview", async () => {
    const all = await store.list("demo");
    const found = await store.search("排序", "demo");
    assert.ok(found.length >= 1);
    assert.ok(all.some((item) => item.id === found[0].id));
  });

  it("renames and deletes sessions", async () => {
    const session = await store.create({
      modelId: "demo",
      modelName: "Demo",
      ollamaName: "demo",
      title: "待删除",
    });
    await store.rename(session.id, "已重命名");
    const renamed = await store.get(session.id);
    assert.equal(renamed.title, "已重命名");
    await store.delete(session.id);
    await assert.rejects(() => store.get(session.id), /会话不存在/);
  });
});

describe("deriveTitle", () => {
  it("truncates long titles", () => {
    const title = deriveTitle("这是一段非常非常非常非常非常非常非常非常长的会话标题内容");
    assert.ok(title.endsWith("…"));
  });
});

describe("exportSessionToMarkdown", () => {
  it("formats session as markdown", () => {
    const md = exportSessionToMarkdown({
      title: "测试对话",
      modelName: "Demo",
      systemPrompt: "你是助手",
      messages: [
        { role: "user", content: "你好" },
        { role: "assistant", content: "你好！" },
      ],
    });
    assert.match(md, /^# 测试对话/);
    assert.match(md, /## System/);
    assert.match(md, /## 用户/);
    assert.match(md, /## 助手/);
    assert.match(md, /你好！/);
  });
});

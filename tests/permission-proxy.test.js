const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { PermissionProxy, DEFAULT_TIMEOUT_MS } = require("../src/main/openclaw/permissions");
const { PermissionAudit } = require("../src/main/openclaw/permission-audit");
const { gateCommand } = require("../src/main/permission-gate");
const { detectRequiredLevel } = require("../src/shared/butler-risk");

test("L1 auto-allows; L3 never auto-allows", async () => {
  const proxy = new PermissionProxy({
    isDesktopOnline: () => true,
    hasConfirmUi: () => true,
    askUser: () => {
      throw new Error("L1 must not ask user");
    },
  });
  const l1 = await proxy.requestPermission({ tool: "pai.list", action: "列出工作流", riskLevel: 1 });
  assert.equal(l1.allowed, true);
  assert.equal(l1.reason, "l1_auto");

  let asked = false;
  const proxyL3 = new PermissionProxy({
    isDesktopOnline: () => true,
    hasConfirmUi: () => true,
    timeoutMs: 50,
    askUser: ({ requestId }) => {
      asked = true;
      // never respond → timeout deny
      assert.ok(requestId);
    },
  });
  const l3 = await proxyL3.requestPermission({ tool: "pai.delete", action: "删除文件 a.txt", riskLevel: 3 });
  assert.equal(asked, true);
  assert.equal(l3.allowed, false);
  assert.equal(l3.reason, "timeout_deny");
});

test("desktop offline / no UI deny high-risk", async () => {
  const offline = new PermissionProxy({
    isDesktopOnline: () => false,
    hasConfirmUi: () => true,
    askUser: async () => {},
  });
  const a = await offline.requestPermission({ tool: "x", action: "备份 PAI", riskLevel: 2 });
  assert.equal(a.allowed, false);
  assert.equal(a.reason, "desktop_offline");

  const noUi = new PermissionProxy({
    isDesktopOnline: () => true,
    hasConfirmUi: () => false,
    askUser: null,
  });
  const b = await noUi.requestPermission({ tool: "x", action: "备份 PAI", riskLevel: 2 });
  assert.equal(b.allowed, false);
  assert.equal(b.reason, "no_ui");
});

test("L3 cannot bypass: deny unless respond(true)", async () => {
  const proxy = new PermissionProxy({
    isDesktopOnline: () => true,
    hasConfirmUi: () => true,
    timeoutMs: 2000,
    askUser: ({ requestId }) => {
      setTimeout(() => proxy.respond(requestId, false, "ui_denied"), 5);
    },
  });
  const denied = await proxy.requestPermission({
    tool: "pai.command",
    action: "删除文件 secret.txt",
    riskLevel: 3,
  });
  assert.equal(denied.allowed, false);

  const proxy2 = new PermissionProxy({
    isDesktopOnline: () => true,
    hasConfirmUi: () => true,
    timeoutMs: 2000,
    askUser: ({ requestId }) => {
      setTimeout(() => proxy2.respond(requestId, true, "ui_approved"), 5);
    },
  });
  const allowed = await proxy2.requestPermission({
    tool: "pai.command",
    action: "删除文件 secret.txt",
    riskLevel: 3,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, "approved");
});

test("dual gate requires Gateway approval after MOGU approve", async () => {
  const proxy = new PermissionProxy({
    isDesktopOnline: () => true,
    hasConfirmUi: () => true,
    timeoutMs: 2000,
    askUser: ({ requestId }) => proxy.respond(requestId, true),
  });
  const missing = await proxy.requestPermission({
    tool: "mogu.pc.delete",
    action: "删除文件 a",
    riskLevel: 3,
    requireGatewayApproval: true,
    gatewayApproved: false,
  });
  assert.equal(missing.allowed, false);
  assert.equal(missing.reason, "gateway_approval_required");

  const both = await proxy.requestPermission({
    tool: "mogu.pc.delete",
    action: "删除文件 a",
    riskLevel: 3,
    requireGatewayApproval: true,
    gatewayApproved: true,
  });
  assert.equal(both.allowed, true);
});

test("audit log records deny and allow", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-perm-"));
  const audit = new PermissionAudit(path.join(dir, "permission-audit.jsonl"));
  const proxy = new PermissionProxy({
    isDesktopOnline: () => false,
    audit,
  });
  await proxy.requestPermission({ tool: "t", action: "删除文件 x", riskLevel: 3 });
  const rows = await audit.list({ limit: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].allowed, false);
  assert.equal(rows[0].reason, "desktop_offline");
  assert.equal(JSON.stringify(rows).includes("token"), false);
});

test("gateCommand maps delete to L3 and blocks without UI", async () => {
  assert.equal(detectRequiredLevel("删除文件 a.txt"), 3);
  const proxy = new PermissionProxy({
    isDesktopOnline: () => true,
    hasConfirmUi: () => false,
  });
  const decision = await gateCommand(proxy, "删除文件 a.txt", { tool: "pai.command" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.requiredLevel, 3);
  assert.equal(decision.reason, "no_ui");
});

test("DEFAULT_TIMEOUT_MS is one minute fail-closed default", () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 60_000);
});

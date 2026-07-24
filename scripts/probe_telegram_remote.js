#!/usr/bin/env node
/**
 * Probe Telegram bot connectivity using SecretStore token (never prints token).
 * Also sends a /status-shaped message to the bound owner chat if --notify.
 */
const path = require("node:path");
const { app } = require("electron");

const ROOT = path.join(__dirname, "..");
const USER_DATA =
  process.env.MOGU_USER_DATA ||
  path.join(process.env.APPDATA || "", "ai-model-manager");
const notify = process.argv.includes("--notify");

app.setPath("userData", USER_DATA);

app.whenReady().then(async () => {
  try {
    const { SecretStore } = require(path.join(ROOT, "src", "main", "secret-store"));
    const { sanitizeRemoteOwner, sanitizeRemoteSettings } =
      require(path.join(ROOT, "src", "main", "remote", "remote-policy"));
    const settings = JSON.parse(
      require("node:fs").readFileSync(path.join(USER_DATA, "settings.json"), "utf8")
    );
    const remote = sanitizeRemoteSettings(settings.remote);
    const owner = sanitizeRemoteOwner(settings.remoteOwner);
    const store = new SecretStore(path.join(USER_DATA, "secrets.json"));
    const token = await store.get("telegramBotToken");
    if (!token) {
      console.log(JSON.stringify({ ok: false, error: "token_missing" }, null, 2));
      app.exit(1);
      return;
    }
    const { net, session } = require("electron");
    try {
      await session.defaultSession.setProxy({ mode: "system" });
    } catch {
      /* ignore */
    }
    const httpFetch = typeof net.fetch === "function" ? net.fetch.bind(net) : fetch;
    const meRes = await httpFetch(`https://api.telegram.org/bot${token}/getMe`);
    const me = await meRes.json();
    let notified = null;
    if (notify && owner.telegramUserId && me.ok) {
      const text = [
        "MOGU Remote Status",
        "GPU: see-device-manager",
        "Task: idle",
        "Model: probe",
        "Queue: 0",
        "Remote: probe-ok",
        "",
        "电脑端配置已生效。请在手机对 bot 发送 /status 做真链路验证。",
      ].join("\n");
      const sendRes = await httpFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: owner.telegramUserId, text }),
      });
      const sendJson = await sendRes.json();
      notified = { ok: Boolean(sendJson.ok), description: sendJson.description || null };
    }
    console.log(
      JSON.stringify(
        {
          ok: Boolean(me.ok),
          botUsername: me.result?.username || null,
          botId: me.result?.id || null,
          remoteEnabled: remote.enabled === true,
          telegramEnabled: remote.telegram?.enabled === true,
          ownerBound: Boolean(owner.telegramUserId),
          ownerId: owner.telegramUserId || null,
          notified,
          secretValuePrinted: false,
        },
        null,
        2
      )
    );
    app.exit(me.ok ? 0 : 1);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    app.exit(1);
  }
});

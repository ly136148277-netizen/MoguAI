#!/usr/bin/env node
"use strict";
const path = require("node:path");
const { app } = require("electron");
const USER = process.env.MOGU_USER_DATA || path.join(process.env.APPDATA || "", "ai-model-manager");
app.setPath("userData", USER);
app.whenReady().then(async () => {
  try {
    const { SecretStore } = require(path.join(__dirname, "..", "src", "main", "secret-store"));
    const settings = JSON.parse(require("node:fs").readFileSync(path.join(USER, "settings.json"), "utf8"));
    const store = new SecretStore(path.join(USER, "secrets.json"));
    const token = await store.get("telegramBotToken");
    if (!token) {
      console.log(JSON.stringify({ ok: false, error: "token_missing" }));
      app.exit(1);
      return;
    }
    const { net, session } = require("electron");
    try {
      await session.defaultSession.setProxy({ mode: "system" });
    } catch {
      /* ignore */
    }
    const httpFetch = net.fetch.bind(net);
    const text = [
      "MOGU Field Status",
      `Brain: ${settings.agentBrainChannel || "unknown"}`,
      `Model: ${settings.agentApiModel || settings.agentLocalModel || "unknown"}`,
      `ControlPlane: ${settings.controlPlaneEnabled === true ? "on" : "off"}`,
      `Remote: ${settings.remote?.enabled === true ? "enabled" : "off"}`,
      "Capability: CHAT/READ ready · ACTION needs YES",
      "",
      "请在手机发送 /status 或「分析我的项目」做真链路验证。",
    ].join("\n");
    const send = await (
      await httpFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: settings.remoteOwner.telegramUserId, text }),
      })
    ).json();
    console.log(
      JSON.stringify(
        {
          ok: Boolean(send.ok),
          notified: Boolean(send.ok),
          description: send.description || null,
          secretValuePrinted: false,
        },
        null,
        2
      )
    );
    app.exit(send.ok ? 0 : 1);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    app.exit(1);
  }
});

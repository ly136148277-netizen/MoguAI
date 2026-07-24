#!/usr/bin/env node
/**
 * One-shot: store Telegram bot token into Electron safeStorage SecretStore.
 * Reads token ONLY from env MOGU_TELEGRAM_BOT_TOKEN. Never prints the value.
 */
const path = require("node:path");
const { app } = require("electron");

const ROOT = path.join(__dirname, "..");
const USER_DATA =
  process.env.MOGU_USER_DATA ||
  path.join(process.env.APPDATA || "", "ai-model-manager");

app.setPath("userData", USER_DATA);

app.whenReady().then(async () => {
  try {
    const token = String(process.env.MOGU_TELEGRAM_BOT_TOKEN || "").trim();
    if (!token || !token.includes(":")) {
      console.error("[remote] FAIL: set MOGU_TELEGRAM_BOT_TOKEN in the environment");
      app.exit(1);
      return;
    }
    const { SecretStore } = require(path.join(ROOT, "src", "main", "secret-store"));
    const store = new SecretStore(path.join(app.getPath("userData"), "secrets.json"));
    if (!store.isEncryptionAvailable()) {
      console.error("[remote] FAIL: Electron safeStorage unavailable");
      app.exit(1);
      return;
    }
    const saved = await store.set("telegramBotToken", token);
    if (!saved?.ok) {
      console.error(`[remote] FAIL: ${saved?.error || "store_failed"}`);
      app.exit(1);
      return;
    }
    const has = await store.hasReference("telegramBotToken");
    console.log(
      JSON.stringify(
        {
          ok: true,
          key: "telegramBotToken",
          encoding: "safeStorage",
          userData: app.getPath("userData"),
          present: has,
          secretValuePrinted: false,
        },
        null,
        2
      )
    );
    app.exit(0);
  } catch (error) {
    console.error(`[remote] FAIL: ${error.message}`);
    app.exit(1);
  }
});

const fs = require("fs-extra");
const path = require("path");

const LEVELS = ["debug", "info", "warn", "error"];

class Logger {
  constructor(logDir) {
    this.logDir = logDir;
    this.logFile = path.join(logDir, "app.log");
  }

  async initialize() {
    await fs.ensureDir(this.logDir);
  }

  async log(level, message, meta = null) {
    if (!LEVELS.includes(level)) {
      level = "info";
    }

    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      meta,
    };

    const line = `${entry.time} [${level.toUpperCase()}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}\n`;

    try {
      await this.initialize();
      await fs.appendFile(this.logFile, line, "utf-8");
    } catch {
      // ignore logging failures
    }

    if (level === "error") {
      console.error(message, meta || "");
    }

    return entry;
  }

  debug(message, meta) {
    return this.log("debug", message, meta);
  }

  info(message, meta) {
    return this.log("info", message, meta);
  }

  warn(message, meta) {
    return this.log("warn", message, meta);
  }

  error(message, meta) {
    return this.log("error", message, meta);
  }
}

module.exports = { Logger };

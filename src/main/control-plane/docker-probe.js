"use strict";

const { spawn } = require("node:child_process");

function probeDockerInstalled() {
  return new Promise((resolve) => {
    const child = spawn("where", ["docker"], { windowsHide: true, shell: true });
    let out = "";
    child.stdout?.on("data", (c) => {
      out += c.toString();
    });
    child.on("error", () => {
      resolve({
        id: "docker",
        title: "容器工具",
        state: "Missing",
        reason: "未安装",
        fix: "高级功能需要时再安装",
        required: false,
      });
    });
    child.on("exit", (code) => {
      if (code === 0 && out.trim()) {
        resolve({
          id: "docker",
          title: "容器工具",
          state: "Installed",
          reason: "已安装",
          fix: "",
          required: false,
        });
      } else {
        resolve({
          id: "docker",
          title: "容器工具",
          state: "Missing",
          reason: "未安装",
          fix: "高级功能需要时再安装",
          required: false,
        });
      }
    });
  });
}

module.exports = { probeDockerInstalled };

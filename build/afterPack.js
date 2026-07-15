const path = require("path");
const { execFileSync } = require("child_process");

/**
 * electron-builder skips rcedit when signAndEditExecutable is false
 * (needed on this machine: winCodeSign extract needs symlink privilege).
 * Stamp the mushroom icon into the packaged exe ourselves.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const icoPath = path.join(context.packager.projectDir, "assets", "icon.ico");
  const rcedit = path.join(
    context.packager.projectDir,
    "node_modules",
    "rcedit",
    "bin",
    "rcedit-x64.exe"
  );

  execFileSync(rcedit, [exePath, "--set-icon", icoPath], { stdio: "inherit" });
  console.log(`afterPack: set icon on ${exePath}`);
};

const path = require("path");
const { execFileSync } = require("child_process");
const { assertResourcesClean } = require("./asar-denylist");

/**
 * electron-builder skips rcedit when signAndEditExecutable is false
 * (needed on this machine: winCodeSign extract needs symlink privilege).
 * Stamp the mushroom icon into the packaged exe ourselves.
 * Also fail the build if app.asar contains secrets / non-runtime files.
 */
exports.default = async function afterPack(context) {
  const check = assertResourcesClean(context.appOutDir);
  console.log(`afterPack: asar denylist OK (${check.entryCount} entries)`);

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

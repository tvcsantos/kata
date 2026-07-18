"use strict";

const { execFileSync } = require("node:child_process");
const path = require("node:path");

/**
 * With no Apple Developer identity, re-sign the packaged macOS app ad-hoc so
 * its signature is internally consistent (electron-builder skips its signing
 * step when no identity is present). Non-fatal: if this fails the app still
 * carries Electron's linker ad-hoc signature and launches.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  try {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
      stdio: "inherit",
    });
    console.log(`  • ad-hoc signed ${appPath}`);
  } catch (error) {
    console.warn(`  • ad-hoc re-sign skipped: ${error.message}`);
  }
};

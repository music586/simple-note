const path = require('path');
const { spawnSync } = require('child_process');

function applyAdhocSignature(appPath) {
  const result = spawnSync('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    appPath
  ], {
    encoding: 'utf-8'
  });

  if (result.status === 0) return;
  throw new Error(`应用 ad-hoc 签名失败：${appPath}\n${result.stderr.trim()}`);
}

function signApplication(appPath, signer = applyAdhocSignature) {
  signer(appPath);
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  signApplication(appPath);
  console.log(`Applied a consistent ad-hoc signature to ${appName}.`);
}

module.exports = afterPack;
module.exports.signApplication = signApplication;

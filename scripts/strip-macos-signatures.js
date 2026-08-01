const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const machOMagicNumbers = new Set([
  'cafebabe',
  'bebafeca',
  'cafebabf',
  'bfbafeca',
  'feedface',
  'cefaedfe',
  'feedfacf',
  'cffaedfe'
]);

function isMachOFile(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  const magic = Buffer.alloc(4);

  try {
    return fs.readSync(descriptor, magic, 0, magic.length, 0) === magic.length
      && machOMagicNumbers.has(magic.toString('hex'));
  } finally {
    fs.closeSync(descriptor);
  }
}

function removeMachOSignature(filePath) {
  const result = spawnSync('/usr/bin/codesign', ['--remove-signature', filePath], {
    encoding: 'utf-8'
  });

  if (result.status === 0 || /code object is not signed at all/.test(result.stderr)) return;
  throw new Error(`移除签名失败：${filePath}\n${result.stderr.trim()}`);
}

function stripResidualSignatures(appPath, removeSignature = removeMachOSignature) {
  const result = { binaries: 0, signatureDirectories: 0 };

  function visit(directoryPath) {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name);

      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name === '_CodeSignature') {
          fs.rmSync(entryPath, { recursive: true, force: true });
          result.signatureDirectories += 1;
        } else {
          visit(entryPath);
        }
      } else if (entry.isFile() && isMachOFile(entryPath)) {
        removeSignature(entryPath);
        result.binaries += 1;
      }
    }
  }

  visit(appPath);
  return result;
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const result = stripResidualSignatures(appPath);

  console.log(
    `Removed residual signatures from ${result.binaries} Mach-O files and `
      + `${result.signatureDirectories} signature directories.`
  );
}

module.exports = afterPack;
module.exports.stripResidualSignatures = stripResidualSignatures;

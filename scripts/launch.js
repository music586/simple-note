const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const electronPath = require('electron');
const appName = '简记';
const appVersion = require('../package.json').version;

function setPlistValue(plist, key, value) {
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  return plist.replace(pattern, `$1${value}$2`);
}

function prepareMacApp() {
  const projectDir = path.resolve(__dirname, '..');
  const sourceApp = path.resolve(electronPath, '..', '..', '..');
  const developmentDir = path.join(projectDir, '.electron');
  const developmentApp = path.join(developmentDir, `${appName}.app`);

  if (!fs.existsSync(developmentApp)) {
    fs.mkdirSync(developmentDir, { recursive: true });
    const result = spawnSync('/bin/cp', ['-cR', sourceApp, developmentApp], {
      stdio: 'inherit'
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }

  const plistPath = path.join(developmentApp, 'Contents', 'Info.plist');
  const bundleIconName = 'jianji.icns';
  const bundleIconPath = path.join(developmentApp, 'Contents', 'Resources', bundleIconName);
  let plist = fs.readFileSync(plistPath, 'utf-8');

  plist = setPlistValue(plist, 'CFBundleDisplayName', appName);
  plist = setPlistValue(plist, 'CFBundleName', appName);
  plist = setPlistValue(plist, 'CFBundleIdentifier', 'com.simple-notes.app');
  plist = setPlistValue(plist, 'CFBundleIconFile', bundleIconName);
  plist = setPlistValue(plist, 'CFBundleShortVersionString', appVersion);
  plist = setPlistValue(plist, 'CFBundleVersion', appVersion);
  fs.copyFileSync(path.join(projectDir, 'icon.icns'), bundleIconPath);
  fs.writeFileSync(plistPath, plist, 'utf-8');

  return developmentApp;
}

const developmentApp = process.platform === 'darwin' ? prepareMacApp() : null;

if (process.argv.includes('--prepare-only')) process.exit(0);

const projectDir = path.resolve(__dirname, '..');
const command = developmentApp ? '/usr/bin/open' : electronPath;
const args = developmentApp
  ? ['-W', '-n', developmentApp, '--args', projectDir, ...process.argv.slice(2)]
  : ['.', ...process.argv.slice(2)];
const child = spawn(command, args, {
  cwd: projectDir,
  stdio: 'inherit'
});

child.on('exit', code => process.exit(code ?? 0));
child.on('error', err => {
  console.error(err.message);
  process.exit(1);
});

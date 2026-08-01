const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'release.yml'
);

test('tag release workflow builds and publishes arm64 and x64 macOS DMGs', () => {
  assert.equal(fs.existsSync(workflowPath), true, 'release workflow must exist');

  const source = fs.readFileSync(workflowPath, 'utf8');

  assert.match(source, /tags:\s*\n\s+- 'v\*\.\*\.\*'/);
  assert.match(source, /contents: write/);
  assert.match(source, /runs-on: macos-latest/);
  assert.match(source, /uses: actions\/checkout@/);
  assert.match(source, /uses: actions\/setup-node@/);
  assert.match(source, /node-version:\s*22/);
  assert.match(source, /npm ci/);
  assert.match(source, /GITHUB_REF_NAME/);
  assert.match(source, /require\('\.\/package\.json'\)\.version/);
  assert.match(source, /npm test/);
  assert.match(source, /npm run dist:mac:arm64 -- --publish never/);
  assert.match(source, /npm run dist:mac:x64 -- --publish never/);
  assert.match(source, /SimpleNote-\$\{version\}-arm64\.dmg/);
  assert.match(source, /SimpleNote-\$\{version\}-x64\.dmg/);
  assert.match(source, /Unexpected universal DMG found/);
  assert.match(source, /Verify unsigned application bundles/);
  assert.match(source, /code object is not signed at all/);
  assert.doesNotMatch(source, /gh release create[^\n]*dist\/\*\.dmg/);
  assert.match(source, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
});

test('package scripts build separate Apple Silicon and Intel installers', () => {
  const packageJson = require('../package.json');
  const target = packageJson.build.mac.target.find(item => item.target === 'dmg');

  assert.equal(packageJson.engines.node, '>=20.19.0');
  assert.equal(
    packageJson.scripts['dist:mac'],
    'npm run dist:mac:arm64 && npm run dist:mac:x64'
  );
  assert.equal(packageJson.scripts['dist:mac:arm64'], 'electron-builder --mac dmg --arm64');
  assert.equal(packageJson.scripts['dist:mac:x64'], 'electron-builder --mac dmg --x64');
  assert.deepEqual(target.arch, ['arm64', 'x64']);
  assert.equal(packageJson.build.afterPack, 'scripts/strip-macos-signatures.js');
  assert.equal(packageJson.build.dmg.artifactName, 'SimpleNote-${version}-${arch}.${ext}');
});

test('macOS packaging hook removes Mach-O signatures and signature resources', async () => {
  const os = require('node:os');
  const { stripResidualSignatures } = require('../scripts/strip-macos-signatures');
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-note-signatures-'));
  const appPath = path.join(temporaryDirectory, '简记.app');
  const executablePath = path.join(appPath, 'Contents', 'MacOS', '简记');
  const signaturePath = path.join(appPath, 'Contents', '_CodeSignature');
  const textPath = path.join(appPath, 'Contents', 'Resources', 'note.txt');

  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.mkdirSync(signaturePath, { recursive: true });
  fs.mkdirSync(path.dirname(textPath), { recursive: true });
  fs.writeFileSync(executablePath, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00]));
  fs.writeFileSync(path.join(signaturePath, 'CodeResources'), 'signature');
  fs.writeFileSync(textPath, 'plain text');

  const removedSignatures = [];
  const result = stripResidualSignatures(appPath, filePath => {
    removedSignatures.push(filePath);
  });

  assert.deepEqual(removedSignatures, [executablePath]);
  assert.equal(fs.existsSync(signaturePath), false);
  assert.equal(fs.existsSync(textPath), true);
  assert.deepEqual(result, { binaries: 1, signatureDirectories: 1 });

  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

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
  assert.equal(packageJson.build.dmg.artifactName, 'SimpleNote-${version}-${arch}.${ext}');
});

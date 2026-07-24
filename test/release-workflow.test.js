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

test('tag release workflow builds and publishes versioned macOS DMG files', () => {
  assert.equal(fs.existsSync(workflowPath), true, 'release workflow must exist');

  const source = fs.readFileSync(workflowPath, 'utf8');

  assert.match(source, /tags:\s*\n\s+- 'v\*\.\*\.\*'/);
  assert.match(source, /contents: write/);
  assert.match(source, /runs-on: macos-latest/);
  assert.match(source, /uses: actions\/checkout@/);
  assert.match(source, /uses: actions\/setup-node@/);
  assert.match(source, /npm ci/);
  assert.match(source, /GITHUB_REF_NAME/);
  assert.match(source, /require\('\.\/package\.json'\)\.version/);
  assert.match(source, /npm test/);
  assert.match(source, /npm run dist:mac/);
  assert.match(source, /gh release create "\$GITHUB_REF_NAME" dist\/\*\.dmg/);
  assert.match(source, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
});

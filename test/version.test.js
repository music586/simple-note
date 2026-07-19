const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('application and lockfile versions are synchronized at 1.0.3', () => {
  const projectRoot = path.join(__dirname, '..');
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  );
  const packageLock = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8')
  );

  assert.equal(packageJson.version, '1.0.3');
  assert.equal(packageLock.version, '1.0.3');
  assert.equal(packageLock.packages[''].version, '1.0.3');
  assert.equal(packageJson.build.dmg.title, 'SimpleNote ${version}');
  assert.equal(
    packageJson.build.dmg.artifactName,
    'SimpleNote-${version}-${arch}.${ext}'
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  getDefaultImageDirectory,
  getConfiguredImageDirectory,
  getImageDirectoryState
} = require('../image-directory');

test('default image directory is the active library assets folder', () => {
  assert.equal(getDefaultImageDirectory('/notes'), path.join('/notes', 'assets'));
});

test('a global absolute custom directory overrides the default', () => {
  assert.deepEqual(getImageDirectoryState(
    { imageDirectory: '/Pictures/SimpleNote' },
    '/notes'
  ), {
    defaultPath: path.join('/notes', 'assets'),
    customPath: path.resolve('/Pictures/SimpleNote'),
    effectivePath: path.resolve('/Pictures/SimpleNote'),
    isCustom: true
  });
  assert.equal(getConfiguredImageDirectory({ imageDirectory: 'relative/path' }), null);
});

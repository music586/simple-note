const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('view menu uses collapse and expand labels', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  assert.match(main, /label: '折叠\/展开侧边栏'/);
  assert.match(main, /label: '折叠\/展开预览'/);
  assert.doesNotMatch(main, /label: '打开\/关闭侧边栏'/);
  assert.doesNotMatch(main, /label: '打开\/关闭预览'/);
});

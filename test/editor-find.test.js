const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findEditorMatches,
  getClosestEditorMatchIndex,
  getNextEditorMatchIndex
} = require('../editor-find');

test('编辑器查找忽略大小写并返回所有非重叠命中', () => {
  assert.deepEqual(
    findEditorMatches('Markdown markdown MARKDOWN', 'markDOWN'),
    [
      { from: 0, to: 8 },
      { from: 9, to: 17 },
      { from: 18, to: 26 }
    ]
  );
});

test('忽略大小写时保持原文 Unicode 索引', () => {
  assert.deepEqual(
    findEditorMatches('İstanbul İstanbul', 'stan'),
    [
      { from: 1, to: 5 },
      { from: 10, to: 14 }
    ]
  );
});

test('空查询不返回命中', () => {
  assert.deepEqual(findEditorMatches('正文', ''), []);
});

test('从光标后的第一个命中开始', () => {
  const matches = [
    { from: 4, to: 7 },
    { from: 12, to: 15 },
    { from: 20, to: 23 }
  ];

  assert.equal(getClosestEditorMatchIndex(matches, 10), 1);
  assert.equal(getClosestEditorMatchIndex(matches, 30), 0);
});

test('上下导航在命中列表首尾循环', () => {
  assert.equal(getNextEditorMatchIndex(2, 3, 1), 0);
  assert.equal(getNextEditorMatchIndex(0, 3, -1), 2);
  assert.equal(getNextEditorMatchIndex(-1, 3, 1), 0);
  assert.equal(getNextEditorMatchIndex(-1, 0, 1), -1);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { compareCharacters, compareLines, buildDiffSummary } = require('../note-history-diff');

test('history diff aligns unchanged, modified, deleted and inserted Markdown lines', () => {
  const rows = compareLines('# 标题\n旧内容\n删除行', '# 标题\n新内容\n新增行');
  assert.deepEqual(rows.map(row => row.type), ['equal', 'modify', 'modify']);
  assert.deepEqual(buildDiffSummary(rows), { inserted: 0, deleted: 0, modified: 2 });
});

test('character diff preserves a shared prefix and suffix', () => {
  const result = compareCharacters('版本内容结束', '版本更新结束');
  assert.deepEqual(result.before.map(part => part.text), ['版本', '内容', '结束']);
  assert.deepEqual(result.after.map(part => part.text), ['版本', '更新', '结束']);
});

test('large documents use a bounded line comparison path', () => {
  const before = Array.from({ length: 1500 }, (_, index) => `旧行 ${index}`).join('\n');
  const after = Array.from({ length: 1500 }, (_, index) => `新行 ${index}`).join('\n');
  const rows = compareLines(before, after);
  assert.equal(rows.length, 1500);
});

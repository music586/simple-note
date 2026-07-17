const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MARKDOWN_STRUCTURE_COMMANDS,
  filterStructureCommands,
  analyzeLineContext
} = require('../markdown-structure');

test('catalog contains headings and line structures', () => {
  assert.deepEqual(
    MARKDOWN_STRUCTURE_COMMANDS.map(command => command.id),
    ['h1', 'h2', 'bullet', 'ordered', 'task', 'quote', 'h3', 'h4', 'h5', 'h6']
  );
});

test('filter matches Chinese, pinyin initials, and Markdown markers', () => {
  assert.equal(filterStructureCommands('任务')[0].id, 'task');
  assert.equal(filterStructureCommands('rw')[0].id, 'task');
  assert.equal(filterStructureCommands('-')[0].id, 'bullet');
  assert.deepEqual(
    filterStructureCommands('标题').map(command => command.id),
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
  );
});

test('slash query exists only at empty-line start and outside fences', () => {
  assert.equal(analyzeLineContext(['/rw'], { line: 0, ch: 3 }).slashQuery, 'rw');
  assert.equal(analyzeLineContext(['text /rw'], { line: 0, ch: 8 }).slashQuery, null);
  assert.equal(analyzeLineContext(['```', '/rw', '```'], { line: 1, ch: 3 }).slashQuery, null);
});

test('context recognizes supported line structures', () => {
  assert.equal(analyzeLineContext(['  - item'], { line: 0, ch: 8 }).type, 'bullet');
  assert.equal(analyzeLineContext(['3. item'], { line: 0, ch: 7 }).number, 3);
  assert.equal(analyzeLineContext(['- [x] done'], { line: 0, ch: 10 }).type, 'task');
  assert.equal(analyzeLineContext(['> > quote'], { line: 0, ch: 9 }).type, 'quote');
  assert.equal(analyzeLineContext(['## title'], { line: 0, ch: 8 }).type, 'heading');
});

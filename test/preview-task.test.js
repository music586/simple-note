const test = require('node:test');
const assert = require('node:assert/strict');

const { getTaskCheckboxEdit } = require('../preview-task');

test('preview task checkbox targets tasks by rendered order', () => {
  const source = '- [ ] first\ntext\n- [x] second';

  assert.deepEqual(getTaskCheckboxEdit(source, 1, false), {
    from: 20,
    to: 21,
    text: ' '
  });
});

test('preview task checkbox supports nested blockquote tasks', () => {
  const source = '> - [ ] quoted\n  * [ ] nested';

  assert.deepEqual(getTaskCheckboxEdit(source, 0, true), {
    from: 5,
    to: 6,
    text: 'x'
  });
  assert.deepEqual(getTaskCheckboxEdit(source, 1, true), {
    from: 20,
    to: 21,
    text: 'x'
  });
});

test('preview task checkbox rejects an index without a matching Markdown task', () => {
  assert.equal(getTaskCheckboxEdit('- [ ] only', 2, true), null);
});

test('preview task checkbox ignores task-like text inside fenced code', () => {
  const source = '```md\n- [ ] example\n```\n- [ ] real';
  const from = source.indexOf('[ ] real') + 1;

  assert.deepEqual(getTaskCheckboxEdit(source, 0, true), {
    from,
    to: from + 1,
    text: 'x'
  });
});

test('preview task checkbox supports tilde fences and longer closing fences', () => {
  const source = '~~~~\n- [ ] example\n~~~~~\n- [ ] real';
  const from = source.indexOf('[ ] real') + 1;

  assert.deepEqual(getTaskCheckboxEdit(source, 0, true), {
    from,
    to: from + 1,
    text: 'x'
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { EditorPanePersistence } = require('../editor-pane-persistence');

function createHarness(initialNote = { name: '原笔记', path: '/notes/original.md' }) {
  let note = initialNote;
  let name = initialNote.name;
  let content = '';
  const calls = [];
  const controller = new EditorPanePersistence({
    getNote: () => note,
    setNote: nextNote => { note = nextNote; },
    getName: () => name,
    getContent: () => content,
    renameNote: async data => {
      calls.push({ type: 'rename', ...data });
      return { name: data.newName, path: `/notes/${data.newName}.md` };
    },
    saveNote: async data => {
      calls.push({ type: 'save', ...data });
      await new Promise(resolve => setTimeout(resolve, 2));
    },
    onRenamed: async () => calls.push({ type: 'tree' })
  });
  return {
    controller,
    calls,
    getNote: () => note,
    setName: value => { name = value; },
    setContent: value => { content = value; }
  };
}

test('pane persistence serializes saves and preserves snapshot order', async () => {
  const harness = createHarness();
  harness.setContent('第一版');
  const first = harness.controller.save();
  harness.setContent('第二版');
  const second = harness.controller.save();
  await Promise.all([first, second]);

  assert.deepEqual(harness.calls.filter(call => call.type === 'save'), [
    { type: 'save', notePath: '/notes/original.md', content: '第一版' },
    { type: 'save', notePath: '/notes/original.md', content: '第二版' }
  ]);
});

test('queued saves follow a renamed note path without writing the old path', async () => {
  const harness = createHarness();
  harness.setName('新名称');
  harness.setContent('重命名内容');
  const first = harness.controller.save();
  harness.setContent('重命名后的新内容');
  const second = harness.controller.save();
  await Promise.all([first, second]);

  const saves = harness.calls.filter(call => call.type === 'save');
  assert.equal(saves[0].notePath, '/notes/新名称.md');
  assert.equal(saves[1].notePath, '/notes/新名称.md');
  assert.equal(saves[1].content, '重命名后的新内容');
  assert.equal(harness.getNote().path, '/notes/新名称.md');
});

test('left and right pane persistence queues do not block each other', async () => {
  const order = [];
  const createController = label => new EditorPanePersistence({
    getNote: () => ({ name: label, path: `/notes/${label}.md` }),
    setNote: () => {},
    getName: () => label,
    getContent: () => `${label}内容`,
    renameNote: async () => {},
    saveNote: async () => {
      order.push(`${label}-start`);
      await new Promise(resolve => setTimeout(resolve, 3));
      order.push(`${label}-end`);
    }
  });

  await Promise.all([createController('左栏').save(), createController('右栏').save()]);
  assert.equal(order.indexOf('左栏-start') < order.indexOf('右栏-end'), true);
  assert.equal(order.indexOf('右栏-start') < order.indexOf('左栏-end'), true);
});

test('manual saves pass their history reason without changing automatic saves', async () => {
  const harness = createHarness();
  harness.setContent('手动保存内容');
  await harness.controller.save({ historyReason: 'manual-save' });
  assert.deepEqual(harness.calls.find(call => call.type === 'save'), {
    type: 'save',
    notePath: '/notes/original.md',
    content: '手动保存内容',
    historyReason: 'manual-save'
  });
});

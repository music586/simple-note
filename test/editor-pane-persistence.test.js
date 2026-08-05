const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { EditorPanePersistence } = require('../editor-pane-persistence');
const { NoteHistoryStore } = require('../note-history');

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
    setNote: value => { note = value; },
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

test('a new document cannot inherit a reused path alias from a renamed note', async () => {
  const reusedPath = '/notes/未命名.md';
  const harness = createHarness({ name: '未命名', path: reusedPath });
  harness.controller.activateDocument(reusedPath);
  harness.setName('项目计划');
  harness.setContent('旧文件内容');
  await harness.controller.save();

  harness.setNote({ name: '未命名', path: reusedPath });
  harness.controller.activateDocument(reusedPath);
  harness.setName('项目计划副本');
  harness.setContent('新文件内容');
  await harness.controller.save();

  const renames = harness.calls.filter(call => call.type === 'rename');
  assert.deepEqual(renames, [
    { type: 'rename', oldPath: reusedPath, newName: '项目计划' },
    { type: 'rename', oldPath: reusedPath, newName: '项目计划副本' }
  ]);
  const saves = harness.calls.filter(call => call.type === 'save');
  assert.equal(saves[0].notePath, '/notes/项目计划.md');
  assert.equal(saves[1].notePath, '/notes/项目计划副本.md');
  assert.equal(saves[1].content, '新文件内容');
});

test('a completed save from the previous document cannot replace the active note', async () => {
  let finishRename;
  let note = { name: '未命名', path: '/notes/未命名.md' };
  let name = '旧文件';
  const controller = new EditorPanePersistence({
    getNote: () => note,
    setNote: nextNote => { note = nextNote; },
    getName: () => name,
    getContent: () => '旧文件内容',
    renameNote: data => new Promise(resolve => {
      finishRename = () => resolve({
        name: data.newName,
        path: `/notes/${data.newName}.md`
      });
    }),
    saveNote: async () => {}
  });

  controller.activateDocument(note.path);
  const pendingSave = controller.save();
  await new Promise(resolve => setImmediate(resolve));
  note = { name: '未命名', path: '/notes/新建/未命名.md' };
  name = '未命名';
  controller.activateDocument(note.path);
  finishRename();
  await pendingSave;

  assert.deepEqual(note, { name: '未命名', path: '/notes/新建/未命名.md' });
});

test('similarly named files keep independent content and snapshot histories', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-note-identity-'));
  const notesPath = path.join(root, 'notes');
  fs.mkdirSync(notesPath);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const history = new NoteHistoryStore({
    historyRoot: path.join(root, 'history'),
    workspacePath: notesPath
  });
  const temporaryPath = path.join(notesPath, '未命名.md');
  let note = { name: '未命名', path: temporaryPath };
  let name = '项目记录';
  let content = '旧文件正文';
  fs.writeFileSync(temporaryPath, '', 'utf8');

  const controller = new EditorPanePersistence({
    getNote: () => note,
    setNote: nextNote => { note = nextNote; },
    getName: () => name,
    getContent: () => content,
    renameNote: async data => {
      const destination = path.join(notesPath, `${data.newName}.md`);
      fs.renameSync(data.oldPath, destination);
      history.migratePath(data.oldPath, destination);
      return { name: data.newName, path: destination };
    },
    saveNote: async data => {
      if (fs.existsSync(data.notePath)) {
        history.record(data.notePath, fs.readFileSync(data.notePath, 'utf8'), {
          reason: 'baseline',
          force: true
        });
      }
      fs.writeFileSync(data.notePath, data.content, 'utf8');
      history.record(data.notePath, data.content, { reason: 'auto-save' });
    }
  });

  controller.activateDocument(temporaryPath);
  await controller.save();
  const originalPath = path.join(notesPath, '项目记录.md');

  fs.writeFileSync(temporaryPath, '', 'utf8');
  note = { name: '未命名', path: temporaryPath };
  name = '项目记录补充';
  content = '新文件正文';
  controller.activateDocument(temporaryPath);
  await controller.save();
  const newPath = path.join(notesPath, '项目记录补充.md');

  assert.equal(fs.readFileSync(originalPath, 'utf8'), '旧文件正文');
  assert.equal(fs.readFileSync(newPath, 'utf8'), '新文件正文');
  const readHistory = notePath => history.list(notePath).map(version => (
    history.read(notePath, version.id).content
  ));
  assert.deepEqual(readHistory(originalPath), ['旧文件正文', '']);
  assert.deepEqual(readHistory(newPath), ['新文件正文', '']);
});

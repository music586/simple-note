const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { NoteHistoryStore } = require('../note-history');

function createStore(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-note-history-'));
  const workspacePath = path.join(root, 'notes');
  fs.mkdirSync(workspacePath);
  return {
    root,
    workspacePath,
    store: new NoteHistoryStore({
      historyRoot: path.join(root, 'history'),
      workspacePath,
      ...options
    })
  };
}

test('history snapshots deduplicate content and keep a baseline before auto-save buckets', t => {
  const harness = createStore();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const notePath = path.join(harness.workspacePath, 'note.md');
  harness.store.record(notePath, '初始内容', {
    reason: 'baseline',
    force: true,
    savedAt: '2026-08-04T00:00:00.000Z'
  });
  harness.store.record(notePath, '第一轮编辑', {
    savedAt: '2026-08-04T00:01:00.000Z'
  });
  harness.store.record(notePath, '第一轮编辑', {
    savedAt: '2026-08-04T00:02:00.000Z'
  });
  harness.store.record(notePath, '第一轮最新内容', {
    savedAt: '2026-08-04T00:03:00.000Z'
  });

  const versions = harness.store.list(notePath);
  assert.equal(versions.length, 2);
  assert.equal(harness.store.read(notePath, versions[0].id).content, '第一轮最新内容');
  assert.equal(harness.store.read(notePath, versions[1].id).content, '初始内容');
});

test('history starts a new bucket after five minutes and enforces the version limit', t => {
  const harness = createStore({ maxVersions: 2 });
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const notePath = path.join(harness.workspacePath, 'note.md');
  ['00:00', '00:06', '00:12'].forEach((time, index) => {
    harness.store.record(notePath, `版本 ${index + 1}`, {
      savedAt: `2026-08-04T${time}:00.000Z`
    });
  });
  assert.deepEqual(
    harness.store.list(notePath).map(version => version.savedAt),
    ['2026-08-04T00:12:00.000Z', '2026-08-04T00:06:00.000Z']
  );
});

test('history follows note and folder moves without exposing another path', t => {
  const harness = createStore();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const sourceFolder = path.join(harness.workspacePath, '旧目录');
  const sourceNote = path.join(sourceFolder, 'note.md');
  const targetFolder = path.join(harness.workspacePath, '新目录');
  const targetNote = path.join(targetFolder, 'note.md');
  harness.store.record(sourceNote, '需要跟随移动', { force: true });
  harness.store.migratePath(sourceFolder, targetFolder);

  assert.equal(harness.store.list(sourceNote).length, 0);
  const versions = harness.store.list(targetNote);
  assert.equal(versions.length, 1);
  assert.equal(harness.store.read(targetNote, versions[0].id).content, '需要跟随移动');
});

test('restored content can be surrounded by forced recovery snapshots', t => {
  const harness = createStore();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const notePath = path.join(harness.workspacePath, 'note.md');
  harness.store.record(notePath, '历史内容', { reason: 'baseline', force: true });
  const historicalVersion = harness.store.list(notePath)[0];
  harness.store.record(notePath, '恢复前内容', { reason: 'before-restore', force: true });
  const restored = harness.store.read(notePath, historicalVersion.id).content;
  harness.store.record(notePath, restored, { reason: 'restore', force: true });

  assert.deepEqual(
    harness.store.list(notePath).map(version => version.reason),
    ['restore', 'before-restore', 'baseline']
  );
});

test('pinned versions keep labels and survive retention and cleanup', t => {
  const harness = createStore({ maxVersions: 2 });
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const notePath = path.join(harness.workspacePath, 'note.md');
  harness.store.record(notePath, '发布版', {
    reason: 'manual-save',
    force: true,
    savedAt: '2026-08-04T00:00:00.000Z'
  });
  const release = harness.store.list(notePath)[0];
  harness.store.updateVersion(notePath, release.id, {
    label: '正式发布版',
    note: '客户确认的内容',
    pinned: true
  });
  ['00:06', '00:12', '00:18'].forEach((time, index) => {
    harness.store.record(notePath, `普通版本 ${index}`, {
      force: true,
      savedAt: `2026-08-04T${time}:00.000Z`
    });
  });

  const versions = harness.store.list(notePath);
  assert.equal(versions.length, 3);
  assert.equal(versions.find(version => version.id === release.id).label, '正式发布版');
  const cleanup = harness.store.cleanup(notePath);
  assert.equal(cleanup.removed, 1);
  assert.equal(harness.store.list(notePath).some(version => version.id === release.id), true);
});

test('history settings and storage statistics are persisted per workspace', t => {
  const harness = createStore();
  t.after(() => fs.rmSync(harness.root, { recursive: true, force: true }));
  const notePath = path.join(harness.workspacePath, 'note.md');
  harness.store.record(notePath, '统计内容', { force: true });
  const settings = harness.store.updateSettings({
    bucketMinutes: 10,
    maxVersions: 80,
    maxAgeDays: 365
  });
  const stats = harness.store.getStats();
  assert.deepEqual(settings, { bucketMinutes: 10, maxVersions: 80, maxAgeDays: 365 });
  assert.equal(stats.versions, 1);
  assert.equal(stats.bytes, Buffer.byteLength('统计内容'));
  assert.deepEqual(stats.settings, settings);
});

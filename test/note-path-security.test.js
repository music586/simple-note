const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveLibraryPath,
  validateEntryName,
  writeFileAtomically
} = require('../note-path-security');

function withLibrary(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-note-security-'));
  const library = path.join(root, 'notes');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(library);
  fs.mkdirSync(outside);
  try {
    run({ root, library, outside });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('note paths stay inside the active library and require Markdown files', () => {
  withLibrary(({ library, outside }) => {
    const note = path.join(library, 'note.md');
    const text = path.join(library, 'note.txt');
    fs.writeFileSync(note, '安全内容');
    fs.writeFileSync(text, 'text');

    assert.equal(resolveLibraryPath(library, note, { markdownOnly: true }), fs.realpathSync(note));
    assert.throws(
      () => resolveLibraryPath(library, path.join(outside, 'escape.md'), { mustExist: false }),
      /不在当前笔记库/
    );
    assert.throws(
      () => resolveLibraryPath(library, text, { markdownOnly: true }),
      /必须使用 \.md/
    );
  });
});

test('symbolic links cannot escape the active library', () => {
  withLibrary(({ library, outside }) => {
    const outsideNote = path.join(outside, 'secret.md');
    const link = path.join(library, 'linked.md');
    fs.writeFileSync(outsideNote, 'secret');
    fs.symlinkSync(outsideNote, link);

    assert.throws(
      () => resolveLibraryPath(library, link, { markdownOnly: true }),
      /不在当前笔记库/
    );
  });
});

test('entry names reject traversal and path separators', () => {
  assert.equal(validateEntryName(' 产品记录 ', '笔记名称'), '产品记录');
  for (const name of ['', '.', '..', '../secret', 'folder/note', 'folder\\note']) {
    assert.throws(() => validateEntryName(name, '笔记名称'), /无效|无效字符/);
  }
});

test('atomic writes replace content without leaving temporary files', () => {
  withLibrary(({ library }) => {
    const note = path.join(library, 'atomic.md');
    fs.writeFileSync(note, '旧内容');
    writeFileAtomically(note, '新内容');

    assert.equal(fs.readFileSync(note, 'utf8'), '新内容');
    assert.deepEqual(fs.readdirSync(library), ['atomic.md']);
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('Help menu opens release notes in the active editor', () => {
  assert.match(main, /label: '帮助'[\s\S]*label: '更新说明'/);
  assert.match(main, /sendToActiveWindow\('open-release-notes', app\.getVersion\(\)\)/);
  assert.doesNotMatch(main, /showReleaseNotesWindow|releaseNotesWindow/);
  assert.match(renderer, /ipcRenderer\.on\('open-release-notes', showReleaseNotes\)/);
});

test('Help menu opens the update page in the system browser', () => {
  assert.match(
    main,
    /label: '帮助'[\s\S]*label: '更新页面'[\s\S]*shell\.openExternal\('https:\/\/github\.com\/music586\/simple-note\/releases'\)/
  );
});

test('release notes contain one collapsible paragraph block per version', () => {
  const versions = [
    '1.1.5',
    '1.1.4',
    '1.1.3',
    '1.1.2',
    '1.1.1',
    '1.1.0',
    '1.0.6',
    '1.0.5',
    '1.0.4',
    '1.0.3',
    '1.0.2',
    '1.0.1',
    '1.0.0'
  ];

  versions.forEach(version => {
    assert.match(renderer, new RegExp(`version: '${version}'`));
  });
  assert.match(renderer, /document\.createElement\('details'\)/);
  assert.match(renderer, /overview\.className = 'editor-release-overview'/);
  assert.match(renderer, /changes\.appendChild\(item\)/);
});

test('every release displays its published date inside the version content', () => {
  const dates = [
    '2026-08-01',
    '2026-07-30',
    '2026-07-26',
    '2026-07-25',
    '2026-07-24',
    '2026-07-23',
    '2026-07-19',
    '2026-07-18',
    '2026-07-17',
    '2026-07-16'
  ];

  dates.forEach(date => {
    assert.match(renderer, new RegExp(`date: '${date}'`));
  });
  assert.match(renderer, /releaseDate\.className = 'editor-release-date'/);
  assert.match(renderer, /releaseDate\.dateTime = release\.date/);
  assert.match(renderer, /releaseDate\.textContent = `发布于 \$\{formatReleaseDate\(release\.date\)\}`/);
  assert.match(styles, /\.editor-release-date\s*\{/);
});

test('current release is featured inside the focused editor pane', () => {
  assert.match(renderer, /lastActiveEditor \|\| editor/);
  assert.match(renderer, /editorAdapter === editorRight \? editorPaneRight : editorPane/);
  assert.match(renderer, /releaseNotes\.find\(release => release\.version === currentVersion\)/);
  assert.match(renderer, /currentCard\.className = 'editor-release-featured'/);
  assert.match(renderer, /createReleaseDetails\(currentRelease, true\)/);
  assert.match(renderer, /release\.highlights\?\.\[index\] \|\| '体验改进'/);
  assert.match(renderer, /pane\.classList\.add\('release-notes-open'\)/);
  assert.match(styles, /\.editor-pane\.release-notes-open > \.CodeMirror/);
  assert.match(styles, /\.editor-release-change strong/);
});

test('release notes title replaces the filename while the view is open', () => {
  assert.match(renderer, /function setReleaseNotesHeading\(pane, visible\)/);
  assert.match(renderer, /title\.textContent = '更新说明'/);
  assert.match(renderer, /setReleaseNotesHeading\(pane, true\)/);
  assert.match(renderer, /setReleaseNotesHeading\(pane, false\)/);
  assert.doesNotMatch(renderer, /editor-release-header|RELEASE NOTES/);
  assert.match(
    styles,
    /\.note-heading-row\.release-notes-heading \.note-title-input\s*\{[^}]*display: none;/s
  );
});

test('older releases are grouped in one collapsed history category', () => {
  assert.match(renderer, /historyGroup\.className = 'editor-release-history'/);
  assert.match(renderer, /historyHeading\.textContent = '过往版本'/);
  assert.doesNotMatch(renderer, /historyGroup\.open = true/);
  assert.doesNotMatch(renderer, /block\.open = true/);
  assert.match(renderer, /content\.appendChild\(createReleaseDetails\(release\)\)/);
  assert.match(styles, /\.editor-release-history\[open\] > summary/);
  assert.match(styles, /\.editor-release-content \.editor-release-changes/);
});

test('the in-editor release notes view has no back button', () => {
  assert.doesNotMatch(renderer, /editor-release-back|返回编辑器|backButton/);
  assert.doesNotMatch(styles, /\.editor-release-back/);
});

test('selecting a note from the directory restores normal editor content', () => {
  const selectNote = renderer.slice(
    renderer.indexOf('async function selectNote(note)'),
    renderer.indexOf('let previewTimeout = null')
  );

  assert.match(
    selectNote,
    /closeReleaseNotes\(editorPane, editor, false\)/
  );
  assert.match(
    selectNote,
    /closeReleaseNotes\(editorPaneRight, editorRight, false\)/
  );
  assert.ok(
    selectNote.indexOf('closeReleaseNotes(editorPane, editor, false)')
      < selectNote.indexOf('currentNote.path === note.path'),
    'release notes must close before the same-note early return'
  );
});

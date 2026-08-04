const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeExtraKeyName } = require('../codemirror6-adapter');

test('legacy CodeMirror navigation keys are normalized for CodeMirror 6', () => {
  assert.equal(normalizeExtraKeyName('Up'), 'ArrowUp');
  assert.equal(normalizeExtraKeyName('Down'), 'ArrowDown');
  assert.equal(normalizeExtraKeyName('Left'), 'ArrowLeft');
  assert.equal(normalizeExtraKeyName('Right'), 'ArrowRight');
  assert.equal(normalizeExtraKeyName('Esc'), 'Escape');
});

test('modifier keys retain the existing CodeMirror 6 normalization', () => {
  assert.equal(normalizeExtraKeyName('Cmd-A'), 'Meta-a');
  assert.equal(normalizeExtraKeyName('Ctrl-A'), 'Ctrl-a');
  assert.equal(normalizeExtraKeyName('Enter'), 'Enter');
});

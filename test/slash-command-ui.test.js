const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clearSlashCommandAccessibility,
  getSlashCommandMenuLayout,
  setSlashCommandAccessibility
} = require('../slash-command-ui');

function createInput() {
  const attributes = new Map();
  return {
    attributes,
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    }
  };
}

test('slash menu accessibility follows the focused CodeMirror input lifecycle', () => {
  const input = createInput();

  setSlashCommandAccessibility(input, 'slash-command-heading');
  assert.deepEqual(Object.fromEntries(input.attributes), {
    'aria-controls': 'slashCommandMenu',
    'aria-expanded': 'true',
    'aria-activedescendant': 'slash-command-heading'
  });

  setSlashCommandAccessibility(input, null);
  assert.equal(input.attributes.has('aria-activedescendant'), false);
  clearSlashCommandAccessibility(input);
  assert.deepEqual(Object.fromEntries(input.attributes), {});
});

test('slash menu layout remains inside narrow and normal panels', () => {
  const narrow = getSlashCommandMenuLayout(
    { left: 100, right: 180, top: 20, bottom: 300, width: 80 },
    { left: 170, top: 40, bottom: 60 },
    { width: 240, height: 100 },
    400
  );
  assert.deepEqual(narrow, { maxWidth: 64, left: 108, top: 64 });

  const normal = getSlashCommandMenuLayout(
    { left: 100, right: 500, top: 20, bottom: 300, width: 400 },
    { left: 450, top: 40, bottom: 60 },
    { width: 180, height: 100 },
    400
  );
  assert.deepEqual(normal, { maxWidth: 384, left: 312, top: 64 });
});

test('slash menu flips above when it cannot fit below', () => {
  const layout = getSlashCommandMenuLayout(
    { left: 100, right: 500, top: 20, bottom: 200, width: 400 },
    { left: 200, top: 150, bottom: 170 },
    { width: 180, height: 100 },
    220
  );

  assert.deepEqual(layout, { maxWidth: 384, left: 200, top: 46 });
});

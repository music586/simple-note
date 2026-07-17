const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MARKDOWN_STRUCTURE_COMMANDS,
  filterStructureCommands,
  analyzeLineContext,
  getEnterEdit,
  getIndentEdit,
  getBackspaceEdit
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

test('fence closes only with a valid run at least as long as its opener', () => {
  assert.equal(analyzeLineContext(['````', '```', '/rw'], { line: 2, ch: 3 }).inFence, true);
  assert.equal(
    analyzeLineContext(['```', '```not-a-close', '/rw'], { line: 2, ch: 3 }).inFence,
    true
  );
  assert.equal(analyzeLineContext(['````', '`````   ', '/rw'], { line: 2, ch: 3 }).inFence, false);
});

test('slash query requires only whitespace after the cursor', () => {
  assert.equal(analyzeLineContext(['/rw remaining'], { line: 0, ch: 3 }).slashQuery, null);
  assert.equal(analyzeLineContext(['/rw   '], { line: 0, ch: 3 }).slashQuery, 'rw');
});

test('Enter continues supported structures', () => {
  assert.deepEqual(getEnterEdit(analyzeLineContext(['- item'], { line: 0, ch: 6 })), {
    from: { line: 0, ch: 6 },
    to: { line: 0, ch: 6 },
    text: '\n- ',
    cursor: { line: 1, ch: 2 }
  });
  assert.deepEqual(getEnterEdit(analyzeLineContext(['3. item'], { line: 0, ch: 7 })), {
    from: { line: 0, ch: 7 },
    to: { line: 0, ch: 7 },
    text: '\n4. ',
    cursor: { line: 1, ch: 3 }
  });
  assert.deepEqual(getEnterEdit(analyzeLineContext(['- [x] done'], { line: 0, ch: 10 })), {
    from: { line: 0, ch: 10 },
    to: { line: 0, ch: 10 },
    text: '\n- [ ] ',
    cursor: { line: 1, ch: 6 }
  });
  assert.deepEqual(getEnterEdit(analyzeLineContext(['> > quote'], { line: 0, ch: 9 })), {
    from: { line: 0, ch: 9 },
    to: { line: 0, ch: 9 },
    text: '\n> > ',
    cursor: { line: 1, ch: 4 }
  });
  assert.deepEqual(getEnterEdit(analyzeLineContext(['## title'], { line: 0, ch: 8 })), {
    from: { line: 0, ch: 8 },
    to: { line: 0, ch: 8 },
    text: '\n',
    cursor: { line: 1, ch: 0 }
  });
});

test('Enter inserts a continuation without replacing a mid-line suffix', () => {
  assert.deepEqual(getEnterEdit(analyzeLineContext(['- item suffix'], { line: 0, ch: 6 })), {
    from: { line: 0, ch: 6 },
    to: { line: 0, ch: 6 },
    text: '\n- ',
    cursor: { line: 1, ch: 2 }
  });
});

test('Enter exits empty list and quote items but continues an empty heading', () => {
  const cases = [
    ['  - ', 4],
    ['3. ', 3],
    ['- [ ] ', 6],
    ['> ', 2]
  ];
  for (const [line, ch] of cases) {
    assert.deepEqual(getEnterEdit(analyzeLineContext([line], { line: 0, ch })), {
      from: { line: 0, ch: 0 },
      to: { line: 0, ch },
      text: '',
      cursor: { line: 0, ch: 0 }
    });
  }

  assert.deepEqual(getEnterEdit(analyzeLineContext(['## '], { line: 0, ch: 3 })), {
    from: { line: 0, ch: 3 },
    to: { line: 0, ch: 3 },
    text: '\n',
    cursor: { line: 1, ch: 0 }
  });
});

test('Tab and Shift+Tab change list indentation by two spaces', () => {
  const context = analyzeLineContext(['- item'], { line: 0, ch: 2 });
  assert.deepEqual(getIndentEdit(context, 1), {
    from: { line: 0, ch: 0 },
    to: { line: 0, ch: 0 },
    text: '  ',
    cursor: { line: 0, ch: 4 }
  });
  const nested = analyzeLineContext(['  - item'], { line: 0, ch: 4 });
  assert.deepEqual(getIndentEdit(nested, -1), {
    from: { line: 0, ch: 0 },
    to: { line: 0, ch: 2 },
    text: '',
    cursor: { line: 0, ch: 2 }
  });
  assert.equal(getIndentEdit(analyzeLineContext(['plain'], { line: 0, ch: 2 }), 1), null);
});

test('Backspace outdents nested items before removing top-level markers', () => {
  const nested = getBackspaceEdit(analyzeLineContext(['  - item'], { line: 0, ch: 4 }));
  assert.deepEqual(nested, {
    from: { line: 0, ch: 0 },
    to: { line: 0, ch: 2 },
    text: '',
    cursor: { line: 0, ch: 2 }
  });
  const top = getBackspaceEdit(analyzeLineContext(['- item'], { line: 0, ch: 2 }));
  assert.deepEqual(top, {
    from: { line: 0, ch: 0 },
    to: { line: 0, ch: 2 },
    text: '',
    cursor: { line: 0, ch: 0 }
  });
  assert.equal(getBackspaceEdit(analyzeLineContext(['- item'], { line: 0, ch: 4 })), null);
});

test('keyboard transformations return null inside fenced code', () => {
  const context = analyzeLineContext(['```', '  - item', '```'], { line: 1, ch: 4 });
  assert.equal(getEnterEdit(context), null);
  assert.equal(getIndentEdit(context, 1), null);
  assert.equal(getBackspaceEdit(context), null);
});

test('outdent transformations preserve tab and mixed whitespace indentation', () => {
  for (const line of ['\t\t- item', ' \t- item']) {
    const context = analyzeLineContext([line], { line: 0, ch: 4 });
    assert.equal(getIndentEdit(context, -1), null);
    assert.equal(getBackspaceEdit(context), null);
  }
});

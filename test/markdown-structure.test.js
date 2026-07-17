const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MARKDOWN_STRUCTURE_COMMANDS,
  filterStructureCommands,
  getRenderedListPrefix,
  getHeadingSectionRange,
  getDocumentOutline,
  getFencedCodeBlocks,
  analyzeLineContext,
  getEnterEdit,
  getIndentEdit,
  getBackspaceEdit,
  getSlashMenuUpdate,
  getSlashCommandEdit
} = require('../markdown-structure');

test('slash menu exposes pure update and guarded-selection helpers', () => {
  assert.equal(typeof getSlashMenuUpdate, 'function');
  assert.equal(typeof getSlashCommandEdit, 'function');
});

test('document outline returns headings outside fenced code', () => {
  assert.deepEqual(getDocumentOutline([
    '# Intro',
    '```md',
    '## ignored',
    '```',
    '### Details'
  ]), [
    { line: 0, level: 1, text: 'Intro' },
    { line: 4, level: 3, text: 'Details' }
  ]);
});

test('fenced code blocks support tilde markers and require matching closers', () => {
  assert.deepEqual(getFencedCodeBlocks([
    '~~~~js',
    '# code',
    '```',
    '~~~~~',
    '# prose'
  ]), [{
    start: 0,
    end: 3,
    language: 'js',
    closed: true
  }]);
});

test('document outline ignores headings in tilde fenced code', () => {
  assert.deepEqual(getDocumentOutline([
    '~~~',
    '# ignored',
    '~~~',
    '# visible'
  ]), [{ line: 3, level: 1, text: 'visible' }]);
});

test('heading section ends before the next same or higher heading', () => {
  const lines = [
    '# A',
    'body',
    '## child',
    'child body',
    '# B',
    'tail'
  ];

  assert.deepEqual(getHeadingSectionRange(lines, 0), {
    level: 1,
    startLine: 1,
    endLine: 3
  });
  assert.deepEqual(getHeadingSectionRange(lines, 2), {
    level: 2,
    startLine: 3,
    endLine: 3
  });
  assert.equal(getHeadingSectionRange(lines, 1), null);
});

test('headings inside fenced code do not end a collapsible section', () => {
  const lines = ['# A', '```', '# code', '```', 'body'];
  assert.deepEqual(getHeadingSectionRange(lines, 0), {
    level: 1,
    startLine: 1,
    endLine: 4
  });
});

test('slash menu update refreshes deletion back to the full command catalog', () => {
  const taskUpdate = getSlashMenuUpdate(['/任务'], { line: 0, ch: 3 }, {
    hasCurrentNote: true,
    composing: false
  });
  const initialUpdate = getSlashMenuUpdate(['/'], { line: 0, ch: 1 }, {
    hasCurrentNote: true,
    composing: false
  });

  assert.equal(taskUpdate.commands[0].id, 'task');
  assert.equal(initialUpdate.query, '');
  assert.equal(initialUpdate.commands.length, 6);
});

test('slash menu update is inactive without a note or during composition', () => {
  assert.equal(getSlashMenuUpdate(['/'], { line: 0, ch: 1 }, {
    hasCurrentNote: false,
    composing: false
  }), null);
  assert.equal(getSlashMenuUpdate(['/'], { line: 0, ch: 1 }, {
    hasCurrentNote: true,
    composing: true
  }), null);
});

test('slash selection edit requires the current query, owner, note, and empty selection', () => {
  const options = {
    expectedQuery: 'rw',
    prefix: '- [ ] ',
    ownsMenu: true,
    hasCurrentNote: true,
    selectionEmpty: true
  };

  assert.deepEqual(getSlashCommandEdit(['/rw'], { line: 0, ch: 3 }, options), {
    from: { line: 0, ch: 0 },
    to: { line: 0, ch: 3 },
    text: '- [ ] ',
    cursor: { line: 0, ch: 6 }
  });
  assert.equal(getSlashCommandEdit(['/other'], { line: 0, ch: 6 }, options), null);
  assert.equal(getSlashCommandEdit(['/rw'], { line: 0, ch: 3 }, {
    ...options,
    ownsMenu: false
  }), null);
  assert.equal(getSlashCommandEdit(['/rw'], { line: 0, ch: 3 }, {
    ...options,
    hasCurrentNote: false
  }), null);
  assert.equal(getSlashCommandEdit(['/rw'], { line: 0, ch: 3 }, {
    ...options,
    selectionEmpty: false
  }), null);
});

test('slash selection edit rejects moved cursors and invalid ranges', () => {
  const options = {
    expectedQuery: 'rw',
    prefix: '- [ ] ',
    ownsMenu: true,
    hasCurrentNote: true,
    selectionEmpty: true
  };

  assert.equal(getSlashCommandEdit(['/rw'], { line: 0, ch: 1 }, options), null);
  assert.equal(getSlashCommandEdit(['text /rw'], { line: 0, ch: 8 }, options), null);
  assert.equal(getSlashCommandEdit(['/rw'], { line: 1, ch: 0 }, options), null);
  assert.equal(getSlashCommandEdit(['/rw'], { line: 0, ch: 4 }, options), null);
});

test('catalog contains headings and line structures', () => {
  assert.deepEqual(
    MARKDOWN_STRUCTURE_COMMANDS.map(command => command.id),
    ['h1', 'h3', 'bullet', 'ordered', 'task', 'quote']
  );
});

test('filter matches Chinese, pinyin initials, and Markdown markers', () => {
  assert.equal(filterStructureCommands('任务')[0].id, 'task');
  assert.equal(filterStructureCommands('rw')[0].id, 'task');
  assert.equal(filterStructureCommands('-')[0].id, 'bullet');
  assert.deepEqual(
    filterStructureCommands('标题').map(command => command.id),
    ['h1', 'h3']
  );
});

test('rendered list prefixes preserve ordered numbers and task state', () => {
  assert.deepEqual(getRenderedListPrefix('  12. item'), {
    type: 'ordered',
    label: '12.',
    fromCh: 2,
    toCh: 6
  });
  assert.equal(getRenderedListPrefix('3) item').label, '3)');
  assert.equal(getRenderedListPrefix('- item').label, '•');
  assert.deepEqual(getRenderedListPrefix('- [x] done'), {
    type: 'task',
    checked: true,
    fromCh: 0,
    toCh: 6,
    toggleCh: 3
  });
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

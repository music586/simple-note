const MARKDOWN_STRUCTURE_COMMANDS = [
  {
    id: 'h1',
    label: '一级标题',
    hint: '#',
    prefix: '# ',
    keywords: ['标题', 'bt', 'h1', '#']
  },
  {
    id: 'h3',
    label: '三级标题',
    hint: '###',
    prefix: '### ',
    keywords: ['标题', 'bt', 'h3', '###']
  },
  {
    id: 'bullet',
    label: '无序列表',
    hint: '-',
    prefix: '- ',
    keywords: ['无序', '列表', 'wx', 'lb', '-']
  },
  {
    id: 'ordered',
    label: '有序列表',
    hint: '1.',
    prefix: '1. ',
    keywords: ['有序', '列表', 'yx', 'lb', '1.']
  },
  {
    id: 'task',
    label: '任务列表',
    hint: '- [ ]',
    prefix: '- [ ] ',
    keywords: ['任务', '列表', 'rw', 'lb', '[]']
  },
  { id: 'quote', label: '引用', hint: '>', prefix: '> ', keywords: ['引用', 'yy', '>'] }
];

function filterStructureCommands(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return MARKDOWN_STRUCTURE_COMMANDS;
  return MARKDOWN_STRUCTURE_COMMANDS.filter(command => (
    command.label.includes(normalized)
      || command.id.includes(normalized)
      || command.keywords.some(keyword => keyword.toLowerCase().includes(normalized))
  ));
}

function getRenderedListPrefix(lineText) {
  const task = lineText.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+/);
  if (task) {
    return {
      type: 'task',
      checked: task[2].toLowerCase() === 'x',
      fromCh: task[1].length,
      toCh: task[0].length,
      toggleCh: task[0].indexOf('[') + 1
    };
  }

  const ordered = lineText.match(/^(\s*)(\d+)([.)])\s+/);
  if (ordered) {
    return {
      type: 'ordered',
      label: `${ordered[2]}${ordered[3]}`,
      fromCh: ordered[1].length,
      toCh: ordered[0].length
    };
  }

  const bullet = lineText.match(/^(\s*)[-*+]\s+/);
  if (!bullet) return null;
  return {
    type: 'bullet',
    label: '•',
    fromCh: bullet[1].length,
    toCh: bullet[0].length
  };
}

function getFencedCodeBlocks(lines) {
  const blocks = [];
  let openBlock = null;

  lines.forEach((line, lineNumber) => {
    if (!openBlock) {
      const opener = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (!opener) return;
      openBlock = {
        start: lineNumber,
        end: lines.length - 1,
        language: opener[2].trim().split(/\s+/)[0] || '',
        closed: false,
        marker: opener[1][0],
        length: opener[1].length
      };
      return;
    }

    const closer = line.match(/^\s*(`+|~+)\s*$/);
    if (!closer
      || closer[1][0] !== openBlock.marker
      || closer[1].length < openBlock.length) return;
    blocks.push({
      start: openBlock.start,
      end: lineNumber,
      language: openBlock.language,
      closed: true
    });
    openBlock = null;
  });

  if (openBlock) {
    blocks.push({
      start: openBlock.start,
      end: openBlock.end,
      language: openBlock.language,
      closed: false
    });
  }
  return blocks;
}

function isInsideFence(lines, targetLine) {
  return getFencedCodeBlocks(lines).some(block => (
    block.start < targetLine && block.end >= targetLine
  ));
}

function getHeadingSectionRange(lines, headingLine) {
  const fencedLines = new Set();
  getFencedCodeBlocks(lines).forEach(block => {
    for (let line = block.start; line <= block.end; line += 1) fencedLines.add(line);
  });
  const heading = lines[headingLine]?.match(/^(#{1,6})\s+/);
  if (!heading || fencedLines.has(headingLine)) return null;
  const level = heading[1].length;
  let endLine = lines.length - 1;

  for (let line = headingLine + 1; line < lines.length; line += 1) {
    if (fencedLines.has(line)) continue;
    const nextHeading = lines[line].match(/^(#{1,6})\s+/);
    if (nextHeading && nextHeading[1].length <= level) {
      endLine = line - 1;
      break;
    }
  }

  return { level, startLine: headingLine + 1, endLine };
}

function getDocumentOutline(lines) {
  const outline = [];
  const fencedLines = new Set();
  getFencedCodeBlocks(lines).forEach(block => {
    for (let line = block.start; line <= block.end; line += 1) fencedLines.add(line);
  });
  lines.forEach((line, lineNumber) => {
    if (fencedLines.has(lineNumber)) return;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (!heading) return;
    const text = heading[2].replace(/\s+#+\s*$/, '').trim();
    if (text) outline.push({ line: lineNumber, level: heading[1].length, text });
  });
  return outline;
}

function analyzeLineContext(lines, cursor) {
  const text = lines[cursor.line] || '';
  const before = text.slice(0, cursor.ch);
  const after = text.slice(cursor.ch);
  const indent = (text.match(/^\s*/) || [''])[0];
  const inFence = isInsideFence(lines, cursor.line);
  const slashMatch = !inFence && !after.trim() ? before.match(/^\/(.*)$/) : null;
  const task = text.match(/^(\s*)- \[([ xX])\]\s?(.*)$/);
  const bullet = text.match(/^(\s*)[-+*]\s+(.*)$/);
  const ordered = text.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
  const quote = text.match(/^(\s*)((?:>\s*)+)(.*)$/);
  const heading = text.match(/^(\s*)#{1,6}\s+(.*)$/);
  let type = 'plain';
  let marker = '';
  let content = text.trim();
  let number = null;

  if (task) [type, marker, content] = ['task', `${task[1]}- [${task[2]}] `, task[3]];
  else if (bullet) {
    [type, marker, content] = [
      'bullet',
      text.slice(0, text.length - bullet[2].length),
      bullet[2]
    ];
  }
  else if (ordered) {
    type = 'ordered';
    marker = text.slice(0, text.length - ordered[3].length);
    content = ordered[3];
    number = Number(ordered[2]);
  } else if (quote) [type, marker, content] = ['quote', `${quote[1]}${quote[2]}`, quote[3]];
  else if (heading) {
    [type, marker, content] = [
      'heading',
      text.slice(0, text.length - heading[2].length),
      heading[2]
    ];
  }

  return {
    line: cursor.line,
    ch: cursor.ch,
    text,
    before,
    after,
    indent,
    inFence,
    type,
    marker,
    contentStart: marker.length,
    number,
    emptyItem: type !== 'plain' && !content.trim(),
    slashQuery: slashMatch ? slashMatch[1] : null
  };
}

function createEdit(context, fromCh, toCh, text, cursorLine, cursorCh) {
  return {
    from: { line: context.line, ch: fromCh },
    to: { line: context.line, ch: toCh },
    text,
    cursor: { line: cursorLine, ch: cursorCh }
  };
}

function getEnterEdit(context) {
  if (context.inFence || context.ch < context.contentStart) return null;
  if (!['heading', 'bullet', 'ordered', 'task', 'quote'].includes(context.type)) return null;
  if (context.emptyItem && context.type !== 'heading') {
    return createEdit(context, 0, context.text.length, '', context.line, 0);
  }

  let continuation = '';
  if (context.type === 'heading') continuation = '\n';
  if (context.type === 'bullet') continuation = `\n${context.indent}- `;
  if (context.type === 'ordered') continuation = `\n${context.indent}${context.number + 1}. `;
  if (context.type === 'task') continuation = `\n${context.indent}- [ ] `;
  if (context.type === 'quote') continuation = `\n${context.marker}`;

  return createEdit(
    context,
    context.ch,
    context.ch,
    continuation,
    context.line + 1,
    continuation.length - 1
  );
}

function getIndentEdit(context, direction) {
  if (context.inFence || !['bullet', 'ordered', 'task'].includes(context.type)) return null;
  if (direction > 0) return createEdit(context, 0, 0, '  ', context.line, context.ch + 2);
  if (!context.indent.startsWith('  ')) return null;
  return createEdit(context, 0, 2, '', context.line, Math.max(0, context.ch - 2));
}

function getBackspaceEdit(context) {
  if (context.inFence || context.ch !== context.contentStart) return null;
  if (!['heading', 'bullet', 'ordered', 'task', 'quote'].includes(context.type)) return null;
  const isList = ['bullet', 'ordered', 'task'].includes(context.type);
  if (isList && context.indent.startsWith('  ')) {
    return createEdit(context, 0, 2, '', context.line, context.ch - 2);
  }
  if (isList && context.indent) return null;
  return createEdit(context, 0, context.contentStart, '', context.line, 0);
}

function isValidCursor(lines, cursor) {
  return Array.isArray(lines)
    && cursor
    && Number.isInteger(cursor.line)
    && Number.isInteger(cursor.ch)
    && cursor.line >= 0
    && cursor.line < lines.length
    && cursor.ch >= 0
    && cursor.ch <= lines[cursor.line].length;
}

function getSlashMenuUpdate(lines, cursor, options) {
  if (!options?.hasCurrentNote || options.composing || !isValidCursor(lines, cursor)) return null;
  const context = analyzeLineContext(lines, cursor);
  if (context.slashQuery === null) return null;
  return {
    query: context.slashQuery,
    commands: filterStructureCommands(context.slashQuery)
  };
}

function getSlashCommandEdit(lines, cursor, options) {
  if (
    !options?.ownsMenu
    || !options.hasCurrentNote
    || !options.selectionEmpty
    || typeof options.expectedQuery !== 'string'
    || typeof options.prefix !== 'string'
    || !isValidCursor(lines, cursor)
  ) {
    return null;
  }

  const context = analyzeLineContext(lines, cursor);
  if (context.slashQuery !== options.expectedQuery) return null;
  return createEdit(
    context,
    0,
    cursor.ch,
    options.prefix,
    cursor.line,
    options.prefix.length
  );
}

module.exports = {
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
};

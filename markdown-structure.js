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
const LIST_INDENT = '    ';
const LIST_INDENT_SIZE = LIST_INDENT.length;

function filterStructureCommands(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return MARKDOWN_STRUCTURE_COMMANDS;
  return MARKDOWN_STRUCTURE_COMMANDS.filter(command => (
    command.label.includes(normalized)
      || command.id.includes(normalized)
      || command.keywords.some(keyword => keyword.toLowerCase().includes(normalized))
  ));
}

function getIndentVisualWidth(indent) {
  return Array.from(indent).reduce((width, character) => {
    if (character !== '\t') return width + 1;
    return width + LIST_INDENT_SIZE - (width % LIST_INDENT_SIZE);
  }, 0);
}

function getOutdentedIndent(indent) {
  if (!indent) return '';
  const targetWidth = Math.max(0, getIndentVisualWidth(indent) - LIST_INDENT_SIZE);
  let width = 0;
  let retained = '';
  for (const character of indent) {
    const nextWidth = character === '\t'
      ? width + LIST_INDENT_SIZE - (width % LIST_INDENT_SIZE)
      : width + 1;
    if (nextWidth > targetWidth) break;
    retained += character;
    width = nextWidth;
  }
  return retained;
}

function parseMarkdownListLine(lineText) {
  const task = lineText.match(/^(\s*)([-*+])\s+\[([ xX])\]\s?(.*)$/);
  if (task) {
    return {
      type: 'task',
      indent: task[1],
      marker: task[2],
      checked: task[3].toLowerCase() === 'x',
      content: task[4],
      fromCh: task[1].length,
      toCh: lineText.length - task[4].length,
      toggleCh: lineText.indexOf('[') + 1
    };
  }

  const ordered = lineText.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
  if (ordered) {
    return {
      type: 'ordered',
      indent: ordered[1],
      number: Number(ordered[2]),
      label: `${ordered[2]}${ordered[3]}`,
      delimiter: ordered[3],
      content: ordered[4],
      fromCh: ordered[1].length,
      toCh: lineText.length - ordered[4].length
    };
  }

  const bullet = lineText.match(/^(\s*)([-*+])\s+(.*)$/);
  if (!bullet) return null;
  const level = Math.floor(getIndentVisualWidth(bullet[1]) / LIST_INDENT_SIZE);
  return {
    type: 'bullet',
    indent: bullet[1],
    marker: bullet[2],
    content: bullet[3],
    label: level % 3 === 1 ? '◦' : level % 3 === 2 ? '▪' : '•',
    nested: level > 0,
    level,
    fromCh: bullet[1].length,
    toCh: lineText.length - bullet[3].length
  };
}

function getRenderedListPrefix(lineText) {
  return parseMarkdownListLine(lineText);
}

function shouldRenderActiveListPrefix(listPrefix, cursorCh) {
  if (!listPrefix) return false;
  return cursorCh >= listPrefix.toCh;
}

function getActiveBulletSourceCursor(listPrefix, cursorCh) {
  if (!listPrefix || listPrefix.type !== 'bullet') return cursorCh;
  if (cursorCh > listPrefix.fromCh) return cursorCh;
  return listPrefix.fromCh + 1;
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

function getHeadingSectionMap(lines, codeBlocks = getFencedCodeBlocks(lines)) {
  const sections = new Map();
  const openHeadings = [];
  let codeBlockIndex = 0;

  lines.forEach((line, lineNumber) => {
    while (codeBlocks[codeBlockIndex]?.end < lineNumber) codeBlockIndex += 1;
    const codeBlock = codeBlocks[codeBlockIndex];
    if (codeBlock && codeBlock.start <= lineNumber && codeBlock.end >= lineNumber) return;

    const heading = line.match(/^(#{1,6})\s+/);
    if (!heading) return;
    const level = heading[1].length;
    while (openHeadings.length && openHeadings.at(-1).level >= level) {
      const previous = openHeadings.pop();
      sections.set(previous.line, {
        level: previous.level,
        startLine: previous.line + 1,
        endLine: lineNumber - 1
      });
    }
    openHeadings.push({ line: lineNumber, level });
  });

  while (openHeadings.length) {
    const heading = openHeadings.pop();
    sections.set(heading.line, {
      level: heading.level,
      startLine: heading.line + 1,
      endLine: lines.length - 1
    });
  }
  return sections;
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
  const list = parseMarkdownListLine(text);
  const quote = text.match(/^(\s*)((?:>\s*)+)(.*)$/);
  const heading = text.match(/^(\s*)#{1,6}\s+(.*)$/);
  let type = 'plain';
  let marker = '';
  let content = text.trim();
  let number = null;

  let listMarker = null;
  let orderedDelimiter = null;
  if (list) {
    type = list.type;
    marker = text.slice(0, list.toCh);
    content = list.content;
    number = list.number ?? null;
    listMarker = list.marker || null;
    orderedDelimiter = list.delimiter || null;
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
    listMarker,
    orderedDelimiter,
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
    const isList = ['bullet', 'ordered', 'task'].includes(context.type);
    const outdentedIndent = getOutdentedIndent(context.indent);
    if (isList && outdentedIndent !== context.indent) {
      return createEdit(
        context,
        0,
        context.indent.length,
        outdentedIndent,
        context.line,
        Math.max(0, context.ch - context.indent.length + outdentedIndent.length)
      );
    }
    return createEdit(context, 0, context.text.length, '', context.line, 0);
  }

  let continuation = '';
  if (context.type === 'heading') continuation = '\n';
  if (context.type === 'bullet') continuation = `\n${context.indent}${context.listMarker} `;
  if (context.type === 'ordered') {
    continuation = `\n${context.indent}${context.number + 1}${context.orderedDelimiter} `;
  }
  if (context.type === 'task') continuation = `\n${context.indent}${context.listMarker} [ ] `;
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
  if (direction > 0) {
    return createEdit(
      context,
      0,
      0,
      LIST_INDENT,
      context.line,
      context.ch + LIST_INDENT.length
    );
  }
  const outdentedIndent = getOutdentedIndent(context.indent);
  if (outdentedIndent === context.indent) return null;
  return createEdit(
    context,
    0,
    context.indent.length,
    outdentedIndent,
    context.line,
    Math.max(0, context.ch - context.indent.length + outdentedIndent.length)
  );
}

function getBackspaceEdit(context) {
  if (context.inFence || context.ch !== context.contentStart) return null;
  if (!['heading', 'bullet', 'ordered', 'task', 'quote'].includes(context.type)) return null;
  const isList = ['bullet', 'ordered', 'task'].includes(context.type);
  const outdentedIndent = getOutdentedIndent(context.indent);
  if (isList && outdentedIndent !== context.indent) {
    return createEdit(
      context,
      0,
      context.indent.length,
      outdentedIndent,
      context.line,
      context.ch - context.indent.length + outdentedIndent.length
    );
  }
  if (isList && context.indent) return null;
  return createEdit(context, 0, context.contentStart, '', context.line, 0);
}

function getSoftBreakEdit(context) {
  if (context.inFence || context.ch < context.contentStart) return null;
  if (!['bullet', 'ordered', 'task'].includes(context.type)) return null;
  const markerWidth = context.contentStart - context.indent.length;
  const continuationIndent = `${context.indent}${' '.repeat(markerWidth)}`;
  return createEdit(
    context,
    context.ch,
    context.ch,
    `\n${continuationIndent}`,
    context.line + 1,
    continuationIndent.length
  );
}

function getListSelectionIndentEdit(lines, from, to, direction) {
  if (!Array.isArray(lines) || !from || !to || direction === 0) return null;
  const startLine = Math.min(from.line, to.line);
  let endLine = Math.max(from.line, to.line);
  const endPosition = from.line > to.line ? from : to;
  if (endLine > startLine && endPosition.ch === 0) endLine -= 1;
  const fencedLines = new Set();
  getFencedCodeBlocks(lines).forEach(block => {
    for (let line = block.start; line <= block.end; line += 1) fencedLines.add(line);
  });
  const selected = lines.slice(startLine, endLine + 1);
  if (!selected.length || selected.some((line, index) => fencedLines.has(startLine + index))) {
    return null;
  }
  const parsedLines = selected.map(parseMarkdownListLine);
  const firstList = parsedLines.find(Boolean);
  if (!firstList) return null;
  const baseIndentWidth = getIndentVisualWidth(firstList.indent);
  const belongsToList = selected.every((line, index) => {
    if (!line.trim() || parsedLines[index]) return true;
    const indent = (line.match(/^\s*/) || [''])[0];
    return getIndentVisualWidth(indent) > baseIndentWidth;
  });
  if (!belongsToList) return null;
  const changes = selected.map(line => {
    if (direction > 0) return `${LIST_INDENT}${line}`;
    const indent = (line.match(/^\s*/) || [''])[0];
    return `${getOutdentedIndent(indent)}${line.slice(indent.length)}`;
  });
  if (direction < 0 && changes.every((line, index) => line === selected[index])) return null;
  const added = direction > 0 ? LIST_INDENT.length : null;
  const adjustCh = (line, ch) => {
    if (line < startLine || line > endLine) return ch;
    if (added !== null) return ch + added;
    const indent = (lines[line].match(/^\s*/) || [''])[0];
    const outdentedIndent = getOutdentedIndent(indent);
    return Math.max(0, ch - indent.length + outdentedIndent.length);
  };
  return {
    from: { line: startLine, ch: 0 },
    to: { line: endLine, ch: lines[endLine].length },
    text: changes.join('\n'),
    cursor: { line: endPosition.line, ch: adjustCh(endPosition.line, endPosition.ch) },
    selection: {
      anchor: { line: from.line, ch: adjustCh(from.line, from.ch) },
      head: { line: to.line, ch: adjustCh(to.line, to.ch) }
    },
    historyLabel: direction > 0 ? '缩进列表' : '减少列表缩进'
  };
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
  LIST_INDENT_SIZE,
  filterStructureCommands,
  parseMarkdownListLine,
  getIndentVisualWidth,
  getRenderedListPrefix,
  shouldRenderActiveListPrefix,
  getActiveBulletSourceCursor,
  getHeadingSectionRange,
  getHeadingSectionMap,
  getDocumentOutline,
  getFencedCodeBlocks,
  analyzeLineContext,
  getEnterEdit,
  getSoftBreakEdit,
  getIndentEdit,
  getListSelectionIndentEdit,
  getBackspaceEdit,
  getSlashMenuUpdate,
  getSlashCommandEdit
};

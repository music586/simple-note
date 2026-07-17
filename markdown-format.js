const inlineFormats = {
  bold: ['**', '**', '加粗文本'],
  italic: ['*', '*', '倾斜文本'],
  highlight: ['==', '==', '高亮文本'],
  strikethrough: ['~~', '~~', '删除线文本'],
  comment: ['<!-- ', ' -->', '注释']
};

function createWrappedEdit(value, start, end, open, close, placeholder) {
  const selected = value.slice(start, end) || placeholder;
  return {
    from: start,
    to: end,
    text: `${open}${selected}${close}`,
    selectionStart: start + open.length,
    selectionEnd: start + open.length + selected.length
  };
}

function getMarkdownFormatEdit(value, start, end, format) {
  const source = String(value || '');
  const safeStart = Math.max(0, Math.min(start, source.length));
  const safeEnd = Math.max(safeStart, Math.min(end, source.length));
  if (format === 'bold') {
    const selected = source.slice(safeStart, safeEnd);
    const includesMarkers = selected.startsWith('**') && selected.endsWith('**')
      && selected.length >= 4;
    const surroundedByMarkers = source.slice(safeStart - 2, safeStart) === '**'
      && source.slice(safeEnd, safeEnd + 2) === '**';
    if (includesMarkers) {
      const text = selected.slice(2, -2);
      return {
        from: safeStart,
        to: safeEnd,
        text,
        selectionStart: safeStart,
        selectionEnd: safeStart + text.length
      };
    }
    if (surroundedByMarkers) {
      return {
        from: safeStart - 2,
        to: safeEnd + 2,
        text: selected,
        selectionStart: safeStart - 2,
        selectionEnd: safeEnd - 2
      };
    }
  }
  if (format === 'italic') {
    const selected = source.slice(safeStart, safeEnd);
    const includesMarkers = selected.startsWith('*') && selected.endsWith('*')
      && !selected.startsWith('**') && !selected.endsWith('**')
      && selected.length >= 2;
    const surroundedByMarkers = source[safeStart - 1] === '*'
      && source[safeEnd] === '*'
      && source[safeStart - 2] !== '*'
      && source[safeEnd + 1] !== '*';
    if (includesMarkers) {
      const text = selected.slice(1, -1);
      return {
        from: safeStart,
        to: safeEnd,
        text,
        selectionStart: safeStart,
        selectionEnd: safeStart + text.length
      };
    }
    if (surroundedByMarkers) {
      return {
        from: safeStart - 1,
        to: safeEnd + 1,
        text: selected,
        selectionStart: safeStart - 1,
        selectionEnd: safeEnd - 1
      };
    }
  }
  if (inlineFormats[format]) {
    return createWrappedEdit(source, safeStart, safeEnd, ...inlineFormats[format]);
  }

  if (format.startsWith('heading-')) {
    const lineStart = source.lastIndexOf('\n', safeStart - 1) + 1;
    const nextBreak = source.indexOf('\n', safeEnd);
    const lineEnd = nextBreak === -1 ? source.length : nextBreak;
    const line = source.slice(lineStart, lineEnd);
    const content = line.replace(/^\s*#{1,6}\s*/, '');
    const level = format === 'heading-none' ? 0 : Number(format.slice(8));
    const prefix = level >= 1 && level <= 6 ? `${'#'.repeat(level)} ` : '';
    return {
      from: lineStart,
      to: lineEnd,
      text: `${prefix}${content}`,
      selectionStart: lineStart + prefix.length,
      selectionEnd: lineStart + prefix.length + content.length
    };
  }

  const selected = source.slice(safeStart, safeEnd);
  if (format === 'code-block') {
    return createWrappedEdit(source, safeStart, safeEnd, '```\n', '\n```', '代码');
  }
  if (format === 'math') {
    return selected.includes('\n')
      ? createWrappedEdit(source, safeStart, safeEnd, '$$\n', '\n$$', '公式')
      : createWrappedEdit(source, safeStart, safeEnd, '$', '$', '公式');
  }
  if (format === 'insert-link') {
    const label = selected || '链接文字';
    const url = 'https://';
    return {
      from: safeStart,
      to: safeEnd,
      text: `[${label}](${url})`,
      selectionStart: safeStart + label.length + 3,
      selectionEnd: safeStart + label.length + 3 + url.length
    };
  }
  if (format === 'insert-image') {
    const alt = selected || '图片描述';
    const imagePath = '图片路径';
    return {
      from: safeStart,
      to: safeEnd,
      text: `![${alt}](${imagePath})`,
      selectionStart: safeStart + alt.length + 4,
      selectionEnd: safeStart + alt.length + 4 + imagePath.length
    };
  }
  if (format === 'insert-rule') {
    const before = source.slice(0, safeStart);
    const after = source.slice(safeEnd);
    let prefix = '';
    let suffix = '\n\n';
    if (before && !before.endsWith('\n\n')) prefix = before.endsWith('\n') ? '\n' : '\n\n';
    if (after.startsWith('\n\n')) suffix = '';
    else if (after.startsWith('\n')) suffix = '\n';
    const text = `${prefix}---${suffix}`;
    return {
      from: safeStart,
      to: safeEnd,
      text,
      selectionStart: safeStart + text.length,
      selectionEnd: safeStart + text.length
    };
  }
  return null;
}

module.exports = { getMarkdownFormatEdit };

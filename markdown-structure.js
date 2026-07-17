const MARKDOWN_STRUCTURE_COMMANDS = [
  {
    id: 'h1',
    label: '一级标题',
    hint: '#',
    prefix: '# ',
    keywords: ['标题', 'bt', 'h1', '#']
  },
  {
    id: 'h2',
    label: '二级标题',
    hint: '##',
    prefix: '## ',
    keywords: ['标题', 'bt', 'h2', '##']
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
  { id: 'quote', label: '引用', hint: '>', prefix: '> ', keywords: ['引用', 'yy', '>'] },
  {
    id: 'h3',
    label: '三级标题',
    hint: '###',
    prefix: '### ',
    keywords: ['标题', 'bt', 'h3', '###']
  },
  {
    id: 'h4',
    label: '四级标题',
    hint: '####',
    prefix: '#### ',
    keywords: ['标题', 'bt', 'h4', '####']
  },
  {
    id: 'h5',
    label: '五级标题',
    hint: '#####',
    prefix: '##### ',
    keywords: ['标题', 'bt', 'h5', '#####']
  },
  {
    id: 'h6',
    label: '六级标题',
    hint: '######',
    prefix: '###### ',
    keywords: ['标题', 'bt', 'h6', '######']
  }
];

function filterStructureCommands(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return MARKDOWN_STRUCTURE_COMMANDS.slice(0, 6);
  return MARKDOWN_STRUCTURE_COMMANDS.filter(command => (
    command.label.includes(normalized)
      || command.id.includes(normalized)
      || command.keywords.some(keyword => keyword.toLowerCase().includes(normalized))
  ));
}

function isInsideFence(lines, targetLine) {
  let fence = null;
  for (let index = 0; index < targetLine; index += 1) {
    if (!fence) {
      const opener = lines[index].match(/^\s*(`{3,}|~{3,})/);
      if (opener) fence = { marker: opener[1][0], length: opener[1].length };
      continue;
    }

    const closer = lines[index].match(/^\s*(`+|~+)\s*$/);
    if (
      closer
      && closer[1][0] === fence.marker
      && closer[1].length >= fence.length
    ) {
      fence = null;
    }
  }
  return Boolean(fence);
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

module.exports = {
  MARKDOWN_STRUCTURE_COMMANDS,
  filterStructureCommands,
  analyzeLineContext
};

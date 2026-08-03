function compareCharacters(before, after) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  return {
    before: [
      { type: 'equal', text: before.slice(0, prefix) },
      { type: 'delete', text: before.slice(prefix, before.length - suffix) },
      { type: 'equal', text: suffix ? before.slice(-suffix) : '' }
    ].filter(part => part.text),
    after: [
      { type: 'equal', text: after.slice(0, prefix) },
      { type: 'insert', text: after.slice(prefix, after.length - suffix) },
      { type: 'equal', text: suffix ? after.slice(-suffix) : '' }
    ].filter(part => part.text)
  };
}

function buildOperations(beforeLines, afterLines) {
  const rows = beforeLines.length + 1;
  const columns = afterLines.length + 1;
  if (rows * columns > 2_000_000) {
    return [
      ...beforeLines.map(text => ({ type: 'delete', before: text })),
      ...afterLines.map(text => ({ type: 'insert', after: text }))
    ];
  }
  const table = Array.from({ length: rows }, () => new Uint32Array(columns));
  for (let left = beforeLines.length - 1; left >= 0; left -= 1) {
    for (let right = afterLines.length - 1; right >= 0; right -= 1) {
      table[left][right] = beforeLines[left] === afterLines[right]
        ? table[left + 1][right + 1] + 1
        : Math.max(table[left + 1][right], table[left][right + 1]);
    }
  }
  const operations = [];
  let left = 0;
  let right = 0;
  while (left < beforeLines.length || right < afterLines.length) {
    if (
      left < beforeLines.length
      && right < afterLines.length
      && beforeLines[left] === afterLines[right]
    ) {
      operations.push({ type: 'equal', before: beforeLines[left], after: afterLines[right] });
      left += 1;
      right += 1;
    } else if (
      right < afterLines.length
      && (left === beforeLines.length || table[left][right + 1] >= table[left + 1][right])
    ) {
      operations.push({ type: 'insert', after: afterLines[right] });
      right += 1;
    } else {
      operations.push({ type: 'delete', before: beforeLines[left] });
      left += 1;
    }
  }
  return operations;
}

function compareLines(before, after) {
  const operations = buildOperations(String(before).split('\n'), String(after).split('\n'));
  const rows = [];
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (operation.type === 'equal') {
      rows.push(operation);
      continue;
    }
    const changed = [];
    while (index < operations.length && operations[index].type !== 'equal') {
      changed.push(operations[index]);
      index += 1;
    }
    index -= 1;
    const deleted = changed.filter(item => item.type === 'delete');
    const inserted = changed.filter(item => item.type === 'insert');
    const count = Math.max(deleted.length, inserted.length);
    for (let offset = 0; offset < count; offset += 1) {
      if (deleted[offset] && inserted[offset]) {
        const characters = compareCharacters(deleted[offset].before, inserted[offset].after);
        rows.push({
          type: 'modify',
          before: deleted[offset].before,
          after: inserted[offset].after,
          beforeParts: characters.before,
          afterParts: characters.after
        });
      } else rows.push(deleted[offset] || inserted[offset]);
    }
  }
  return rows;
}

function buildDiffSummary(rows) {
  return rows.reduce((summary, row) => {
    if (row.type === 'insert') summary.inserted += 1;
    if (row.type === 'delete') summary.deleted += 1;
    if (row.type === 'modify') summary.modified += 1;
    return summary;
  }, { inserted: 0, deleted: 0, modified: 0 });
}

module.exports = { compareCharacters, compareLines, buildDiffSummary };

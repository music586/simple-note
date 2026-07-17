const { getFencedCodeBlocks } = require('./markdown-structure');

function getTaskCheckboxEdit(source, taskIndex, checked) {
  const lines = String(source).split('\n');
  const fencedLines = new Set();
  getFencedCodeBlocks(lines).forEach(block => {
    for (let line = block.start; line <= block.end; line += 1) fencedLines.add(line);
  });
  let currentIndex = 0;
  let offset = 0;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    const match = fencedLines.has(lineNumber)
      ? null
      : line.match(/^(?:(?:[ \t]*>[ \t]*)*)[ \t]*[-*+][ \t]+\[([ xX])\]/);
    if (match && currentIndex === taskIndex) {
      const from = offset + match[0].lastIndexOf(']') - 1;
      return { from, to: from + 1, text: checked ? 'x' : ' ' };
    }
    if (match) currentIndex += 1;
    offset += line.length + 1;
  }

  return null;
}

module.exports = { getTaskCheckboxEdit };

const { getFencedCodeBlocks } = require('./markdown-structure');

function normalizePreviewMarkdown(source) {
  const lines = String(source || '').split('\n');
  const fencedLines = new Set();
  getFencedCodeBlocks(lines).forEach(block => {
    for (let line = block.start; line <= block.end; line += 1) fencedLines.add(line);
  });

  return lines.map((line, lineNumber) => {
    if (fencedLines.has(lineNumber)) return line;
    return line.replace(/(\]\(\s*https?:\/\/)[ \t]+/gi, '$1');
  }).join('\n');
}

module.exports = { normalizePreviewMarkdown };

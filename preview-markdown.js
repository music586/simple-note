const { getFencedCodeBlocks } = require('./markdown-structure');
const mermaidFlowchartStartPattern = /^\s*(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/i;
const mermaidDiagramStartPattern = /^\s*(?:sequenceDiagram|stateDiagram-v2|classDiagram|gantt|pie|journey)\b/i;

function wrapImplicitMermaidDiagrams(lines, fencedLines) {
  const output = [];
  let lineNumber = 0;

  while (lineNumber < lines.length) {
    const line = lines[lineNumber];
    const startsDiagram = !fencedLines.has(lineNumber)
      && isMermaidDiagramStart(line);
    if (!startsDiagram) {
      output.push(line);
      lineNumber += 1;
      continue;
    }

    output.push('```mermaid');
    while (
      lineNumber < lines.length
      && !fencedLines.has(lineNumber)
      && lines[lineNumber].trim()
    ) {
      output.push(lines[lineNumber]);
      lineNumber += 1;
    }
    output.push('```');
  }

  return output;
}

function isMermaidDiagramStart(line) {
  return mermaidFlowchartStartPattern.test(line) || mermaidDiagramStartPattern.test(line);
}

function normalizePreviewMarkdown(source) {
  const lines = String(source || '').split('\n');
  const fencedLines = new Set();
  const codeBlocks = getFencedCodeBlocks(lines);
  codeBlocks.forEach(block => {
    for (let line = block.start; line <= block.end; line += 1) fencedLines.add(line);
  });

  const normalizedLines = lines.map((line, lineNumber) => {
    if (fencedLines.has(lineNumber)) return line;
    return line.replace(/(\]\(\s*https?:\/\/)[ \t]+/gi, '$1');
  });
  codeBlocks.forEach(block => {
    if (block.language || !isMermaidDiagramStart(lines[block.start + 1] || '')) return;
    normalizedLines[block.start] = normalizedLines[block.start].replace(
      /(`{3,}|~{3,})\s*$/,
      '$1mermaid'
    );
  });

  return wrapImplicitMermaidDiagrams(normalizedLines, fencedLines).join('\n');
}

module.exports = { isMermaidDiagramStart, normalizePreviewMarkdown };

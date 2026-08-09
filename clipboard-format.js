function normalizeClipboardText(value) {
  return String(value || '').replace(/\r\n?/g, '\n');
}

function joinClipboardTextAndImages(text, imageMarkdown) {
  const normalizedText = normalizeClipboardText(text);
  if (!normalizedText) return imageMarkdown;
  if (!imageMarkdown) return normalizedText;

  const separator = normalizedText.endsWith('\n\n')
    ? ''
    : normalizedText.endsWith('\n') ? '\n' : '\n\n';
  return `${normalizedText}${separator}${imageMarkdown}`;
}

function normalizeClipboardMarkdown(value) {
  const lines = normalizeClipboardText(value).split('\n');
  const normalizedLines = [];
  let fence = null;
  let hasPendingBlankLine = false;

  lines.forEach(line => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      normalizedLines.push(line);
      if (
        fenceMatch
        && fenceMatch[1][0] === fence.marker
        && fenceMatch[1].length >= fence.length
      ) {
        fence = null;
      }
      return;
    }

    const isPlaceholderLine = !line.replace(/[ \t\u00a0\u200b\u3000]/g, '');
    if (isPlaceholderLine) {
      if (normalizedLines.length) hasPendingBlankLine = true;
      return;
    }

    if (hasPendingBlankLine) normalizedLines.push('');
    hasPendingBlankLine = false;
    normalizedLines.push(line);

    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
    }
  });

  return normalizedLines.join('\n');
}

function joinClipboardStructuredContent(documentText, start, end, content) {
  const before = String(documentText || '').slice(0, start);
  const after = String(documentText || '').slice(end);
  const leadingBreak = !before
    ? ''
    : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trailingBreak = !after
    ? ''
    : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return `${leadingBreak}${content}${trailingBreak}`;
}

function removeGeneratedBoundaryNewlines(value) {
  let result = normalizeClipboardText(value);
  if (result.startsWith('\n')) result = result.slice(1);
  if (result.endsWith('\n')) result = result.slice(0, -1);
  return result;
}

function shouldConvertClipboardHtml(html) {
  return /<(?:p|div|section|article|br|strong|b|em|i|a|h[1-6]|ul|ol|li|blockquote)\b/i
    .test(String(html || ''));
}

function isMarkdownDocumentText(text) {
  const normalizedText = normalizeClipboardText(text);
  if (!normalizedText.includes('\n')) return false;
  return /(?:^|\n)\s{0,3}#{1,6}\s+\S/.test(normalizedText)
    || /(?:^|\n)\s{0,3}(?:`{3,}|~{3,})[^\n]*\n/.test(normalizedText)
    || /(?:^|\n)\s*\|?\s*:?-{3,}:?\s*\|/.test(normalizedText);
}

function applyClipboardMarkdownMarks(text, marks) {
  const normalizedText = normalizeClipboardText(text);
  const validMarks = (Array.isArray(marks) ? marks : []).filter(mark => (
    Number.isInteger(mark.start)
      && Number.isInteger(mark.end)
      && mark.start >= 0
      && mark.end > mark.start
      && mark.end <= normalizedText.length
  )).sort((left, right) => right.start - left.start || left.end - right.end);

  return validMarks.reduce((result, mark) => {
    return result.slice(0, mark.start)
      + String(mark.open || '')
      + result.slice(mark.start, mark.end)
      + String(mark.close || '')
      + result.slice(mark.end);
  }, normalizedText);
}

function optimizeClipboardPlainText(text) {
  const normalizedText = normalizeClipboardText(text);
  if (/\n[ \t\u3000]*\n/.test(normalizedText) || normalizedText.includes('\t')) {
    return normalizedText;
  }
  if (/^(?:#{1,6}|[-*+] |\d+[.)] |> |```)/m.test(normalizedText)) return normalizedText;

  const lines = normalizedText.split('\n');
  const contentLines = lines.filter(line => line.length > 0);
  if (contentLines.length < 5) return normalizedText;

  const isIndentedParagraph = line => /^[ \t\u3000]/.test(line);
  const isBoldLine = line => /^\*\*[^\n]+\*\*$/.test(line);
  const getHeadingText = line => isBoldLine(line) ? line.slice(2, -2) : line;
  const isHeading = line => {
    const headingText = getHeadingText(line);
    return !isIndentedParagraph(line)
      && Array.from(headingText).length <= 30
      && !/[。！？；：,.!?;:]$/.test(headingText);
  };
  const indentedCount = contentLines.filter(isIndentedParagraph).length;
  const headings = contentLines.filter(isHeading);
  if (indentedCount / contentLines.length < 0.6 || !headings.length) return normalizedText;

  return lines.map(line => {
    if (!isHeading(line) || isBoldLine(line)) return line;
    return `**${line}**`;
  }).join('\n\n');
}

module.exports = {
  normalizeClipboardText,
  joinClipboardTextAndImages,
  normalizeClipboardMarkdown,
  joinClipboardStructuredContent,
  removeGeneratedBoundaryNewlines,
  shouldConvertClipboardHtml,
  isMarkdownDocumentText,
  applyClipboardMarkdownMarks,
  optimizeClipboardPlainText
};

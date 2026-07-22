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
  removeGeneratedBoundaryNewlines,
  shouldConvertClipboardHtml,
  applyClipboardMarkdownMarks,
  optimizeClipboardPlainText
};

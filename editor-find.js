function findEditorMatches(text, query) {
  if (!query) return [];

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escapedQuery, 'giu');
  const matches = [];

  for (const match of text.matchAll(pattern)) {
    matches.push({
      from: match.index,
      to: match.index + match[0].length
    });
  }

  return matches;
}

function getClosestEditorMatchIndex(matches, cursorIndex) {
  if (!matches.length) return -1;
  const index = matches.findIndex(match => match.from >= cursorIndex);
  return index < 0 ? 0 : index;
}

function getNextEditorMatchIndex(currentIndex, matchCount, direction) {
  if (!matchCount) return -1;
  if (currentIndex < 0) return direction < 0 ? matchCount - 1 : 0;
  return (currentIndex + direction + matchCount) % matchCount;
}

module.exports = {
  findEditorMatches,
  getClosestEditorMatchIndex,
  getNextEditorMatchIndex
};

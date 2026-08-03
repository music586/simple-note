function buildQuickOpenItems(items, parentParts = []) {
  const result = [];
  for (const item of items || []) {
    const parts = [...parentParts, item.name];
    result.push({
      name: item.name,
      path: item.path,
      type: item.type,
      relativePath: parts.join('/')
    });
    if (item.type === 'folder') {
      result.push(...buildQuickOpenItems(item.children, parts));
    }
  }
  return result;
}

function filterQuickOpenItems(items, query, limit = Infinity) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  return items
    .map((item, order) => {
      const name = item.name.toLocaleLowerCase();
      const relativePath = item.relativePath.toLocaleLowerCase();
      const nameIndex = name.indexOf(normalizedQuery);
      const pathIndex = relativePath.indexOf(normalizedQuery);
      if (normalizedQuery && nameIndex < 0 && pathIndex < 0) return null;
      const score = normalizedQuery
        ? (nameIndex >= 0 ? nameIndex : 100 + pathIndex) + relativePath.length / 1000
        : order;
      return { item, score, order };
    })
    .filter(Boolean)
    .sort((left, right) => left.score - right.score || left.order - right.order)
    .slice(0, limit)
    .map(entry => entry.item);
}

module.exports = { buildQuickOpenItems, filterQuickOpenItems };

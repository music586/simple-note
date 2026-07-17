function getTableAddControlState(rect, clientX, clientY, threshold = 28) {
  const distanceRight = Math.abs(rect.right - clientX);
  const distanceBottom = Math.abs(rect.bottom - clientY);
  const nearRight = distanceRight <= threshold;
  const nearBottom = distanceBottom <= threshold;
  if (!nearRight && !nearBottom) return null;

  if (nearRight && (!nearBottom || distanceRight <= distanceBottom)) {
    return { type: 'column' };
  }

  return { type: 'row' };
}

module.exports = { getTableAddControlState };

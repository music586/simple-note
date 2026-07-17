function getEditorCursorAlignment(cursorRect, textRect) {
  if (!cursorRect || !textRect || textRect.height <= 0) return null;
  const textCenter = textRect.top + textRect.height / 2;
  return {
    height: textRect.height,
    offset: textCenter - cursorRect.top - textRect.height / 2
  };
}

function getFallbackTextRect(cursorRect, fontSize) {
  if (!cursorRect || !Number.isFinite(fontSize) || fontSize <= 0) return null;
  const height = fontSize * 1.4;
  return {
    top: cursorRect.top + (cursorRect.height - height) / 2,
    height
  };
}

function getCurrentLineTextRect(cursorRect, textRects) {
  if (!cursorRect || !textRects) return null;
  const rects = Array.from(textRects).filter(rect => rect.height > 0);
  if (!rects.length) return null;
  const cursorCenter = cursorRect.top + cursorRect.height / 2;
  const containing = rects.filter(rect => (
    rect.top <= cursorCenter && rect.top + rect.height >= cursorCenter
  ));
  const candidates = containing.length ? containing : rects;
  const closest = candidates.reduce((best, rect) => {
    const distance = Math.abs(rect.top + rect.height / 2 - cursorCenter);
    const bestDistance = Math.abs(best.top + best.height / 2 - cursorCenter);
    return distance < bestDistance ? rect : best;
  });
  return { top: closest.top, height: closest.height };
}

module.exports = {
  getEditorCursorAlignment,
  getFallbackTextRect,
  getCurrentLineTextRect
};

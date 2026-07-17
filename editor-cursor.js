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

module.exports = {
  getEditorCursorAlignment,
  getFallbackTextRect
};

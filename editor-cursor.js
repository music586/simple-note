function getEditorCursorAlignment(cursorRect, textRect) {
  if (!cursorRect || !textRect || textRect.height <= 0) return null;
  const textCenter = textRect.top + textRect.height / 2;
  return {
    height: textRect.height,
    offset: textCenter - cursorRect.top - textRect.height / 2
  };
}

module.exports = { getEditorCursorAlignment };

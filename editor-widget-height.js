function captureEditorScrollAnchor(codeMirror) {
  const scrollTop = codeMirror.getScrollInfo().top;
  if (
    typeof codeMirror.getViewport !== 'function'
    || typeof codeMirror.heightAtLine !== 'function'
  ) {
    return { line: null, offset: 0, scrollTop };
  }

  const viewport = codeMirror.getViewport();
  const line = Math.max(0, viewport.from);
  return {
    line,
    offset: codeMirror.heightAtLine(line, 'local') - scrollTop,
    scrollTop
  };
}

function restoreEditorScrollAnchor(codeMirror, anchor) {
  const nextScrollTop = anchor.line === null
    ? anchor.scrollTop
    : codeMirror.heightAtLine(anchor.line, 'local') - anchor.offset;
  if (Math.abs(codeMirror.getScrollInfo().top - nextScrollTop) > 0.5) {
    codeMirror.scrollTo(null, nextScrollTop);
  }
}

function preserveEditorScrollPosition(
  codeMirror,
  update,
  requestFrame = requestAnimationFrame
) {
  const anchor = captureEditorScrollAnchor(codeMirror);
  const result = update();
  restoreEditorScrollAnchor(codeMirror, anchor);
  requestFrame(() => restoreEditorScrollAnchor(codeMirror, anchor));
  return result;
}

function scheduleDecorationHeightChange(
  getDecoration,
  codeMirror,
  requestFrame = requestAnimationFrame
) {
  requestFrame(() => {
    const decoration = getDecoration();
    if (typeof decoration?.changed !== 'function') return;

    preserveEditorScrollPosition(codeMirror, () => decoration.changed(), requestFrame);
  });
}

module.exports = {
  captureEditorScrollAnchor,
  restoreEditorScrollAnchor,
  preserveEditorScrollPosition,
  scheduleDecorationHeightChange
};

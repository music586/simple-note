function scheduleDecorationHeightChange(
  getDecoration,
  codeMirror,
  requestFrame = requestAnimationFrame
) {
  requestFrame(() => {
    const decoration = getDecoration();
    if (typeof decoration?.changed !== 'function') return;

    const scrollTop = codeMirror.getScrollInfo().top;
    decoration.changed();
    if (codeMirror.getScrollInfo().top !== scrollTop) {
      codeMirror.scrollTo(null, scrollTop);
    }
  });
}

module.exports = {
  scheduleDecorationHeightChange
};

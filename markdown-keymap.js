function applyCodeMirrorEdit(cm, edit) {
  if (!edit) return false;
  if (typeof cm.applyEdit === 'function') return cm.applyEdit(edit);
  cm.operation(() => {
    cm.replaceRange(edit.text, edit.from, edit.to, 'markdown-structure');
    if (edit.selection && typeof cm.setSelection === 'function') {
      cm.setSelection(edit.selection.anchor, edit.selection.head);
    } else {
      cm.setCursor(edit.cursor);
    }
  });
  return true;
}

function createMarkdownKeyHandlers(dependencies) {
  const {
    Pass,
    getMenuState,
    selectSlashCommand,
    moveSlashCommandSelection,
    closeSlashCommandMenu,
    handleOpeningCodeFence,
    getContext,
    getEnterEdit,
    getSoftBreakEdit,
    getIndentEdit,
    getListSelectionIndentEdit,
    getBackspaceEdit,
    applyEdit
  } = dependencies;

  return editorAdapterOrGetter => {
    const getEditorAdapter = typeof editorAdapterOrGetter === 'function'
      ? editorAdapterOrGetter
      : () => editorAdapterOrGetter;

    function menuIsOwned(state) {
      return !state.hidden && state.editor === getEditorAdapter();
    }

    function handleMenuMove(delta) {
      const state = getMenuState();
      if (!menuIsOwned(state) || state.composing || !state.commands.length) return Pass;
      moveSlashCommandSelection(delta);
    }

    function handleListIndent(cm, direction) {
      if (!cm.somethingSelected()) {
        return applyEdit(cm, getIndentEdit(getContext(cm), direction)) || Pass;
      }
      const lines = Array.from({ length: cm.lineCount() }, (_, line) => cm.getLine(line));
      const selection = typeof cm.getSelectionRange === 'function'
        ? cm.getSelectionRange()
        : { anchor: cm.getCursor('from'), head: cm.getCursor('to') };
      const edit = getListSelectionIndentEdit(
        lines,
        selection.anchor,
        selection.head,
        direction
      );
      return applyEdit(cm, edit) || Pass;
    }

    return {
      Up: () => handleMenuMove(-1),
      Down: () => handleMenuMove(1),
      Esc: () => {
        if (!menuIsOwned(getMenuState())) return Pass;
        closeSlashCommandMenu();
      },
      Enter: cm => {
        if (cm.somethingSelected()) {
          cm.execCommand('newlineAndIndent');
          return;
        }

        const menuState = getMenuState();
        if (menuState.composing) return Pass;
        if (menuIsOwned(menuState)) {
          selectSlashCommand();
          return;
        }
        if (handleOpeningCodeFence(cm, getEditorAdapter())) return;
        if (applyEdit(cm, getEnterEdit(getContext(cm)))) return;
        cm.execCommand('newlineAndIndent');
      },
      'Shift-Enter': cm => {
        if (cm.somethingSelected()) return Pass;
        return applyEdit(cm, getSoftBreakEdit(getContext(cm))) || Pass;
      },
      Tab: cm => {
        return handleListIndent(cm, 1);
      },
      'Shift-Tab': cm => {
        return handleListIndent(cm, -1);
      },
      Backspace: cm => {
        if (cm.somethingSelected()) return Pass;
        return applyEdit(cm, getBackspaceEdit(getContext(cm))) || Pass;
      }
    };
  };
}

module.exports = {
  applyCodeMirrorEdit,
  createMarkdownKeyHandlers
};

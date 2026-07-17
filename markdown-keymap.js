function applyCodeMirrorEdit(cm, edit) {
  if (!edit) return false;
  cm.operation(() => {
    cm.replaceRange(edit.text, edit.from, edit.to, 'markdown-structure');
    cm.setCursor(edit.cursor);
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
    getIndentEdit,
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
      Tab: cm => {
        if (cm.somethingSelected()) return Pass;
        return applyEdit(cm, getIndentEdit(getContext(cm), 1)) || Pass;
      },
      'Shift-Tab': cm => {
        if (cm.somethingSelected()) return Pass;
        return applyEdit(cm, getIndentEdit(getContext(cm), -1)) || Pass;
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

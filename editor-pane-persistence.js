class EditorPanePersistence {
  constructor(options) {
    this.getNote = options.getNote;
    this.setNote = options.setNote;
    this.getName = options.getName;
    this.getContent = options.getContent;
    this.renameNote = options.renameNote;
    this.saveNote = options.saveNote;
    this.onRenamed = options.onRenamed || (() => {});
    this.onError = options.onError || (() => {});
    this.pending = Promise.resolve();
    this.pathAliases = new Map();
    this.activeDocumentPath = null;
    this.documentRevision = 0;
    this.revision = 0;
  }

  activateDocument(notePath) {
    const nextPath = typeof notePath === 'string' && notePath ? notePath : null;
    if (nextPath === this.activeDocumentPath) return;
    this.activeDocumentPath = nextPath;
    this.documentRevision += 1;
    this.pathAliases = new Map();
  }

  save(options = {}) {
    const currentNote = this.getNote();
    if (!currentNote) return Promise.resolve(null);
    const snapshot = {
      revision: ++this.revision,
      note: { ...currentNote },
      name: this.getName().trim() || 'untitled',
      content: this.getContent(),
      historyReason: options.historyReason,
      documentRevision: this.documentRevision,
      pathAliases: this.pathAliases
    };
    const operation = this.pending.catch(() => {}).then(() => this.persist(snapshot));
    this.pending = operation;
    operation.catch(error => this.onError(error));
    return operation;
  }

  async persist(snapshot) {
    const originalPath = snapshot.note.path;
    let notePath = this.resolvePath(originalPath, snapshot.pathAliases);
    let noteName = snapshot.note.name;
    let renamed = false;

    if (snapshot.name !== noteName) {
      const result = await this.renameNote({
        oldPath: notePath,
        newName: snapshot.name
      });
      if (!result?.path) throw new Error('重命名笔记失败');
      snapshot.pathAliases.set(originalPath, result.path);
      snapshot.pathAliases.set(notePath, result.path);
      notePath = result.path;
      noteName = result.name || snapshot.name;
      renamed = true;
      if (snapshot.documentRevision === this.documentRevision) {
        this.activeDocumentPath = result.path;
      }
      this.updateCurrentNote(
        [originalPath, this.resolvePath(originalPath, snapshot.pathAliases)],
        result,
        snapshot
      );
    }

    const savePayload = { notePath, content: snapshot.content };
    if (snapshot.historyReason) savePayload.historyReason = snapshot.historyReason;
    await this.saveNote(savePayload);
    if (renamed) await this.onRenamed({ oldPath: originalPath, newPath: notePath });
    return { revision: snapshot.revision, notePath, name: noteName };
  }

  resolvePath(notePath, aliases = this.pathAliases) {
    let resolvedPath = notePath;
    const visited = new Set();
    while (aliases.has(resolvedPath) && !visited.has(resolvedPath)) {
      visited.add(resolvedPath);
      resolvedPath = aliases.get(resolvedPath);
    }
    return resolvedPath;
  }

  updateCurrentNote(expectedPaths, nextNote, snapshot) {
    if (snapshot.documentRevision !== this.documentRevision) return;
    const currentNote = this.getNote();
    if (!currentNote) return;
    const currentPath = this.resolvePath(currentNote.path, snapshot.pathAliases);
    if (!expectedPaths.some(expectedPath => (
      this.resolvePath(expectedPath, snapshot.pathAliases) === currentPath
    ))) return;
    this.setNote({ ...currentNote, ...nextNote });
  }

  flush() {
    return this.pending.catch(() => {});
  }
}

module.exports = { EditorPanePersistence };

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
    this.revision = 0;
  }

  save(options = {}) {
    const currentNote = this.getNote();
    if (!currentNote) return Promise.resolve(null);
    const snapshot = {
      revision: ++this.revision,
      note: { ...currentNote },
      name: this.getName().trim() || 'untitled',
      content: this.getContent(),
      historyReason: options.historyReason
    };
    const operation = this.pending.catch(() => {}).then(() => this.persist(snapshot));
    this.pending = operation;
    operation.catch(error => this.onError(error));
    return operation;
  }

  async persist(snapshot) {
    const originalPath = snapshot.note.path;
    let notePath = this.resolvePath(originalPath);
    let noteName = snapshot.note.name;
    let renamed = false;

    if (snapshot.name !== noteName) {
      const result = await this.renameNote({
        oldPath: notePath,
        newName: snapshot.name
      });
      if (!result?.path) throw new Error('重命名笔记失败');
      this.pathAliases.set(originalPath, result.path);
      this.pathAliases.set(notePath, result.path);
      notePath = result.path;
      noteName = result.name || snapshot.name;
      renamed = true;
      this.updateCurrentNote([originalPath, this.resolvePath(originalPath)], result);
    }

    const savePayload = { notePath, content: snapshot.content };
    if (snapshot.historyReason) savePayload.historyReason = snapshot.historyReason;
    await this.saveNote(savePayload);
    if (renamed) await this.onRenamed();
    return { revision: snapshot.revision, notePath, name: noteName };
  }

  resolvePath(notePath) {
    let resolvedPath = notePath;
    const visited = new Set();
    while (this.pathAliases.has(resolvedPath) && !visited.has(resolvedPath)) {
      visited.add(resolvedPath);
      resolvedPath = this.pathAliases.get(resolvedPath);
    }
    return resolvedPath;
  }

  updateCurrentNote(expectedPaths, nextNote) {
    const currentNote = this.getNote();
    if (!currentNote) return;
    const currentPath = this.resolvePath(currentNote.path);
    if (!expectedPaths.some(expectedPath => this.resolvePath(expectedPath) === currentPath)) return;
    this.setNote({ ...currentNote, ...nextNote });
  }

  flush() {
    return this.pending.catch(() => {});
  }
}

module.exports = { EditorPanePersistence };

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const defaultMaxVersions = 200;
const defaultBucketDuration = 5 * 60 * 1000;
const defaultMaxAgeDays = 180;

function hashContent(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

class NoteHistoryStore {
  constructor(options) {
    this.workspacePath = path.resolve(options.workspacePath);
    this.maxVersions = options.maxVersions || defaultMaxVersions;
    this.bucketDuration = options.bucketDuration || defaultBucketDuration;
    const workspaceKey = crypto.createHash('sha256')
      .update(this.workspacePath)
      .digest('hex')
      .slice(0, 24);
    this.directory = path.join(options.historyRoot, workspaceKey);
    this.objectsDirectory = path.join(this.directory, 'objects');
    this.indexPath = path.join(this.directory, 'index.json');
    fs.mkdirSync(this.objectsDirectory, { recursive: true });
  }

  loadIndex() {
    if (!fs.existsSync(this.indexPath)) return { version: 1, notes: [] };
    try {
      const index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      if (!index || !Array.isArray(index.notes)) throw new Error('历史索引格式无效');
      return index;
    } catch (error) {
      const backupPath = `${this.indexPath}.invalid-${Date.now()}`;
      fs.renameSync(this.indexPath, backupPath);
      return { version: 1, notes: [] };
    }
  }

  saveIndex(index) {
    writeJsonAtomically(this.indexPath, index);
  }

  getSettings(index = this.loadIndex()) {
    return {
      bucketMinutes: index.settings?.bucketMinutes || this.bucketDuration / 60000,
      maxVersions: index.settings?.maxVersions || this.maxVersions,
      maxAgeDays: index.settings?.maxAgeDays || defaultMaxAgeDays
    };
  }

  updateSettings(settings) {
    const index = this.loadIndex();
    index.settings = {
      bucketMinutes: Math.max(1, Math.min(120, Number(settings.bucketMinutes) || 5)),
      maxVersions: Math.max(10, Math.min(2000, Number(settings.maxVersions) || 200)),
      maxAgeDays: Math.max(1, Math.min(3650, Number(settings.maxAgeDays) || 180))
    };
    this.applyRetention(index);
    this.saveIndex(index);
    this.removeUnreferencedObjects(index);
    return this.getSettings(index);
  }

  findNote(index, notePath, create = false) {
    const resolvedPath = path.resolve(notePath);
    let note = index.notes.find(item => item.path === resolvedPath && !item.archivedAt);
    if (!note && create) {
      note = {
        id: crypto.randomUUID(),
        path: resolvedPath,
        versions: []
      };
      index.notes.push(note);
    }
    return note;
  }

  writeObject(hash, content) {
    const objectPath = path.join(this.objectsDirectory, `${hash}.md`);
    if (!fs.existsSync(objectPath)) {
      fs.writeFileSync(objectPath, content, { encoding: 'utf8', flag: 'wx' });
    }
  }

  record(notePath, content, options = {}) {
    const text = String(content);
    const hash = hashContent(text);
    const index = this.loadIndex();
    const note = this.findNote(index, notePath, true);
    const latest = note.versions[note.versions.length - 1];
    if (latest?.hash === hash) return { created: false, version: latest };

    this.writeObject(hash, text);
    const savedAt = options.savedAt || new Date().toISOString();
    const version = {
      id: crypto.randomUUID(),
      hash,
      savedAt,
      reason: options.reason || 'auto-save',
      size: Buffer.byteLength(text, 'utf8')
    };
    const settings = this.getSettings(index);
    const canReplaceBucket = !options.force
      && latest?.reason === 'auto-save'
      && Date.parse(savedAt) - Date.parse(latest.savedAt) < settings.bucketMinutes * 60000;
    if (canReplaceBucket) note.versions[note.versions.length - 1] = version;
    else note.versions.push(version);
    this.applyRetention(index, Date.parse(savedAt));
    this.saveIndex(index);
    this.removeUnreferencedObjects(index);
    return { created: true, version };
  }

  applyRetention(index, now = Date.now()) {
    const settings = this.getSettings(index);
    const cutoff = now - settings.maxAgeDays * 24 * 60 * 60 * 1000;
    index.notes.forEach(note => {
      note.versions = note.versions.filter(version => (
        version.pinned || Date.parse(version.savedAt) >= cutoff
      ));
      const ordinary = note.versions.filter(version => !version.pinned);
      const removeCount = Math.max(0, ordinary.length - settings.maxVersions);
      if (!removeCount) return;
      const removeIds = new Set(ordinary.slice(0, removeCount).map(version => version.id));
      note.versions = note.versions.filter(version => !removeIds.has(version.id));
    });
  }

  list(notePath, currentContent = null) {
    const index = this.loadIndex();
    const note = this.findNote(index, notePath);
    if (!note) return [];
    const currentHash = currentContent === null ? null : hashContent(String(currentContent));
    return [...note.versions].reverse().map(version => ({
      ...version,
      isCurrent: version.hash === currentHash
    }));
  }

  read(notePath, versionId) {
    const index = this.loadIndex();
    const note = this.findNote(index, notePath);
    const version = note?.versions.find(item => item.id === versionId);
    if (!version) throw new Error('历史版本不存在或已被清理');
    const objectPath = path.join(this.objectsDirectory, `${version.hash}.md`);
    if (!fs.existsSync(objectPath)) throw new Error('历史版本内容缺失');
    return { version, content: fs.readFileSync(objectPath, 'utf8') };
  }

  updateVersion(notePath, versionId, metadata = {}) {
    const index = this.loadIndex();
    const note = this.findNote(index, notePath);
    const version = note?.versions.find(item => item.id === versionId);
    if (!version) throw new Error('历史版本不存在或已被清理');
    version.label = String(metadata.label || '').trim().slice(0, 80);
    version.note = String(metadata.note || '').trim().slice(0, 500);
    version.pinned = Boolean(metadata.pinned);
    this.saveIndex(index);
    return { ...version };
  }

  getStats(notePath = null) {
    const index = this.loadIndex();
    const target = notePath ? this.findNote(index, notePath) : null;
    const notes = target ? [target] : index.notes;
    const versions = notes.flatMap(note => note.versions);
    const objectHashes = new Set(versions.map(version => version.hash));
    const bytes = [...objectHashes].reduce((total, hash) => {
      const objectPath = path.join(this.objectsDirectory, `${hash}.md`);
      return total + (fs.existsSync(objectPath) ? fs.statSync(objectPath).size : 0);
    }, 0);
    return {
      notes: notes.length,
      versions: versions.length,
      pinned: versions.filter(version => version.pinned).length,
      bytes,
      settings: this.getSettings(index)
    };
  }

  cleanup(notePath = null) {
    const index = this.loadIndex();
    const target = notePath ? this.findNote(index, notePath) : null;
    const notes = target ? [target] : index.notes;
    let removed = 0;
    notes.forEach(note => {
      const latest = note.versions[note.versions.length - 1];
      const kept = note.versions.filter(version => version.pinned || version === latest);
      removed += note.versions.length - kept.length;
      note.versions = kept;
    });
    this.saveIndex(index);
    this.removeUnreferencedObjects(index);
    return { removed, stats: this.getStats(notePath) };
  }

  migratePath(sourcePath, destinationPath) {
    const index = this.loadIndex();
    const source = path.resolve(sourcePath);
    const destination = path.resolve(destinationPath);
    const sourcePrefix = source + path.sep;
    let changed = false;
    index.notes.forEach(note => {
      if (note.archivedAt) return;
      if (note.path === source || note.path.startsWith(sourcePrefix)) {
        note.path = path.join(destination, path.relative(source, note.path));
        changed = true;
      }
    });
    if (changed) this.saveIndex(index);
    return changed;
  }

  archivePath(notePath) {
    const index = this.loadIndex();
    const resolvedPath = path.resolve(notePath);
    const pathPrefix = resolvedPath + path.sep;
    const notes = index.notes.filter(note => !note.archivedAt && (
      note.path === resolvedPath || note.path.startsWith(pathPrefix)
    ));
    if (!notes.length) return false;
    const archivedAt = new Date().toISOString();
    notes.forEach(note => { note.archivedAt = archivedAt; });
    this.saveIndex(index);
    return true;
  }

  removeUnreferencedObjects(index = this.loadIndex()) {
    const referenced = new Set(index.notes.flatMap(note => note.versions.map(version => version.hash)));
    fs.readdirSync(this.objectsDirectory).forEach(fileName => {
      if (!fileName.endsWith('.md')) return;
      if (!referenced.has(fileName.slice(0, -3))) {
        fs.unlinkSync(path.join(this.objectsDirectory, fileName));
      }
    });
  }
}

module.exports = {
  NoteHistoryStore,
  defaultBucketDuration,
  defaultMaxAgeDays,
  defaultMaxVersions,
  hashContent
};

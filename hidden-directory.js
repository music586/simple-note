const path = require('path');
const fs = require('fs');
const { writeFileAtomically } = require('./note-path-security');

const defaultHiddenDirectories = ['assets', '.obsidian', '.git'];

function normalizeHiddenDirectory(relativePath) {
  if (typeof relativePath !== 'string') throw new Error('隐藏目录无效');
  const normalized = relativePath.trim().replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (!normalized || normalized.includes('\0') || path.posix.isAbsolute(normalized)) {
    throw new Error('隐藏目录无效');
  }
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '.' || part === '..')) {
    throw new Error('隐藏目录必须位于当前笔记库内');
  }
  return parts.join('/');
}

function getHiddenDirectories(config = {}) {
  const source = Array.isArray(config.hiddenDirectories)
    ? config.hiddenDirectories
    : defaultHiddenDirectories;
  return [...new Set(source.map(item => {
    try {
      return normalizeHiddenDirectory(item);
    } catch (err) {
      return null;
    }
  }).filter(Boolean))];
}

function readLibrarySettings(notesDir) {
  const directory = path.join(notesDir, '.simple-note');
  const filePath = path.join(directory, 'settings.json');
  for (const candidate of [directory, filePath]) {
    try {
      if (fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error('笔记库配置不能使用符号链接');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!fs.existsSync(filePath)) return null;
  const settings = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('笔记库配置格式无效');
  }
  if (settings.hiddenDirectories !== undefined && (
    !Array.isArray(settings.hiddenDirectories) ||
    settings.hiddenDirectories.some(rule => typeof rule !== 'string')
  )) throw new Error('笔记库隐藏目录配置格式无效');
  if (settings.hiddenDirectories) settings.hiddenDirectories.forEach(normalizeHiddenDirectory);
  return settings;
}

function saveLibraryHiddenDirectories(notesDir, directories) {
  const settings = readLibrarySettings(notesDir) || {};
  settings.hiddenDirectories = [...new Set(directories.map(normalizeHiddenDirectory))];
  const directory = path.join(notesDir, '.simple-note');
  fs.mkdirSync(directory, { recursive: true });
  writeFileAtomically(path.join(directory, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  return settings.hiddenDirectories;
}

function getLibraryHiddenDirectories(notesDir, fallbackConfig = {}) {
  const settings = readLibrarySettings(notesDir);
  if (settings) return getHiddenDirectories(settings);
  const directories = getHiddenDirectories(fallbackConfig);
  try {
    saveLibraryHiddenDirectories(notesDir, directories);
  } catch (error) {
    // A read-only library remains readable; explicit saves still report the error.
    if (!['EACCES', 'EPERM', 'EROFS'].includes(error.code)) throw error;
  }
  return directories;
}

function isHiddenDirectory(relativePath, hiddenDirectories) {
  const normalizedPath = String(relativePath || '').replaceAll('\\', '/');
  const pathParts = normalizedPath.split('/').filter(Boolean);
  if (pathParts[0] === '.simple-note') return true;
  return hiddenDirectories.some(rule => {
    if (!rule.includes('/')) return pathParts.includes(rule);
    return normalizedPath === rule || normalizedPath.startsWith(`${rule}/`);
  });
}

module.exports = {
  getLibraryHiddenDirectories,
  saveLibraryHiddenDirectories,
  defaultHiddenDirectories,
  normalizeHiddenDirectory,
  getHiddenDirectories,
  isHiddenDirectory
};

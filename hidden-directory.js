const path = require('path');

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

function isHiddenDirectory(relativePath, hiddenDirectories) {
  const normalizedPath = String(relativePath || '').replaceAll('\\', '/');
  const pathParts = normalizedPath.split('/').filter(Boolean);
  return hiddenDirectories.some(rule => {
    if (!rule.includes('/')) return pathParts.includes(rule);
    return normalizedPath === rule || normalizedPath.startsWith(`${rule}/`);
  });
}

module.exports = {
  defaultHiddenDirectories,
  normalizeHiddenDirectory,
  getHiddenDirectories,
  isHiddenDirectory
};

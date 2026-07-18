const path = require('path');

function getDefaultImageDirectory(notesDir) {
  return path.join(path.resolve(notesDir), 'assets');
}

function getConfiguredImageDirectory(config) {
  const value = config && typeof config.imageDirectory === 'string'
    ? config.imageDirectory.trim()
    : '';
  return value && path.isAbsolute(value) ? path.resolve(value) : null;
}

function getImageDirectoryState(config, notesDir) {
  const defaultPath = getDefaultImageDirectory(notesDir);
  const customPath = getConfiguredImageDirectory(config);
  return {
    defaultPath,
    customPath,
    effectivePath: customPath || defaultPath,
    isCustom: Boolean(customPath)
  };
}

module.exports = {
  getConfiguredImageDirectory,
  getDefaultImageDirectory,
  getImageDirectoryState
};

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function isPathInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === ''
    || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function resolveLibraryPath(notesDirectory, inputPath, options = {}) {
  const {
    mustExist = true,
    expectedType = null,
    markdownOnly = false,
    allowRoot = false
  } = options;
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    throw new Error('文件路径无效');
  }

  const configuredNotesDir = path.resolve(notesDirectory);
  const notesDir = fs.realpathSync(configuredNotesDir);
  const resolvedPath = path.resolve(inputPath);
  if (
    !isPathInside(configuredNotesDir, resolvedPath)
    || (!allowRoot && resolvedPath === configuredNotesDir)
  ) {
    throw new Error('文件路径不在当前笔记库中');
  }

  const exists = fs.existsSync(resolvedPath);
  if (mustExist && !exists) throw new Error('文件或文件夹不存在');
  const checkedPath = exists
    ? fs.realpathSync(resolvedPath)
    : path.join(fs.realpathSync(path.dirname(resolvedPath)), path.basename(resolvedPath));
  if (!isPathInside(notesDir, checkedPath) || (!allowRoot && checkedPath === notesDir)) {
    throw new Error('文件路径不在当前笔记库中');
  }

  if (exists && expectedType) {
    const stat = fs.statSync(checkedPath);
    if (expectedType === 'file' && !stat.isFile()) throw new Error('目标不是文件');
    if (expectedType === 'directory' && !stat.isDirectory()) throw new Error('目标不是文件夹');
  }
  if (markdownOnly && path.extname(checkedPath).toLowerCase() !== '.md') {
    throw new Error('笔记文件必须使用 .md 扩展名');
  }
  return checkedPath;
}

function validateEntryName(name, label = '名称') {
  if (typeof name !== 'string') throw new Error(`${label}无效`);
  const normalizedName = name.trim();
  if (
    !normalizedName
    || normalizedName === '.'
    || normalizedName === '..'
    || normalizedName.includes('/')
    || normalizedName.includes('\\')
    || /[\u0000-\u001f]/.test(normalizedName)
  ) {
    throw new Error(`${label}包含无效字符`);
  }
  return normalizedName;
}

function writeFileAtomically(filePath, content) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf-8', flag: 'wx' });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

module.exports = {
  isPathInside,
  resolveLibraryPath,
  validateEntryName,
  writeFileAtomically
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('folder context menu places Finder reveal below new folder', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const folderMenu = source.slice(
    source.indexOf("} else if (type === 'folder')"),
    source.indexOf("} else if (type === 'root')")
  );
  const newFolderIndex = folderMenu.indexOf("label: '新建文件夹'");
  const revealIndex = folderMenu.indexOf("label: '在访达中显示'");
  const separatorIndex = folderMenu.indexOf(
    "template.push({ type: 'separator' });",
    newFolderIndex
  );

  assert.ok(newFolderIndex >= 0);
  assert.ok(revealIndex > newFolderIndex);
  assert.ok(separatorIndex > newFolderIndex && separatorIndex < revealIndex);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildQuickOpenItems, filterQuickOpenItems } = require('../quick-open');

const tree = [
  {
    type: 'folder',
    name: '产品设计',
    path: '/notes/产品设计',
    children: [
      { type: 'file', name: '版本规划.md', path: '/notes/产品设计/版本规划.md' },
      { type: 'file', name: '交互说明.md', path: '/notes/产品设计/交互说明.md' }
    ]
  },
  { type: 'file', name: '工作记录.md', path: '/notes/工作记录.md' }
];

test('quick open indexes every folder and Markdown file with a relative path', () => {
  assert.deepEqual(buildQuickOpenItems(tree), [
    {
      type: 'folder',
      name: '产品设计',
      path: '/notes/产品设计',
      relativePath: '产品设计'
    },
    {
      type: 'file',
      name: '版本规划.md',
      path: '/notes/产品设计/版本规划.md',
      relativePath: '产品设计/版本规划.md'
    },
    {
      type: 'file',
      name: '交互说明.md',
      path: '/notes/产品设计/交互说明.md',
      relativePath: '产品设计/交互说明.md'
    },
    {
      type: 'file',
      name: '工作记录.md',
      path: '/notes/工作记录.md',
      relativePath: '工作记录.md'
    }
  ]);
});

test('quick open matches names and parent paths while prioritizing name matches', () => {
  const items = buildQuickOpenItems(tree);
  assert.deepEqual(
    filterQuickOpenItems(items, '版本').map(item => item.name),
    ['版本规划.md']
  );
  assert.deepEqual(
    filterQuickOpenItems(items, '产品设计/').map(item => item.name),
    ['版本规划.md', '交互说明.md']
  );
});

test('file menu and renderer expose the quick open keyboard workflow', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

  assert.match(main, /label: '快速打开…',[\s\S]*accelerator: 'CmdOrCtrl\+O'/);
  assert.match(main, /sendToActiveWindow\('quick-open'\)/);
  assert.match(
    main,
    /label: '新建窗口'[\s\S]*?type: 'separator'[\s\S]*?label: '快速打开…'[\s\S]*?label: '查看历史版本…'[\s\S]*?type: 'separator'[\s\S]*?label: '新建笔记'/
  );
  assert.doesNotMatch(main, /label: '修改存储目录'/);
  assert.match(renderer, /ipcRenderer\.on\('quick-open', showQuickOpen\)/);
  assert.match(renderer, /quickOpenInput\.addEventListener\('keydown'/);
  assert.match(renderer, /await selectNote\(item\)/);
  assert.match(html, /id="quickOpenResults"[^>]*role="listbox"/);
  assert.match(
    styles,
    /#quickOpenModal\s*\{[^}]*padding-top:\s*var\(--quick-open-top-space\)[^}]*align-items:\s*flex-start/s
  );
  assert.match(
    styles,
    /\.quick-open-modal-content\s*\{[^}]*max-height:[^;]*var\(--quick-open-top-space\)/s
  );
});

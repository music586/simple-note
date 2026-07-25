const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('main process persists DeepSeek API Key through validated IPC handlers', () => {
  assert.match(
    main,
    /const defaultDeepseekLayoutPrompt = '保证原文的内容，不要随意串改，优化下面的正文排版，'[\s\S]*'使用markdown 标签优化展示，和层级结构'/
  );
  assert.match(main, /ipcMain\.handle\('get-ai-settings'/);
  assert.match(main, /ipcMain\.handle\('set-ai-settings'/);
  assert.match(main, /typeof apiKey !== 'string'/);
  assert.match(main, /config\.deepseekApiKey = normalizedApiKey/);
  assert.match(main, /delete config\.deepseekApiKey/);
  assert.match(main, /config\.deepseekLayoutPrompt = normalizedLayoutPrompt/);
  assert.match(main, /ipcMain\.handle\('set-ai-stamp-position'/);
  assert.match(main, /config\.aiStampPosition = stampPosition/);
  assert.doesNotMatch(main, /console\.(?:log|info|debug)\([^)]*deepseekApiKey/);
});

test('AI menu requests DeepSeek layout optimization for the active window', () => {
  assert.match(
    main,
    /label: 'AI',[\s\S]*label: '优化排版',[\s\S]*sendToActiveWindow\('ai-optimize-layout'\)/
  );
  assert.match(main, /ipcMain\.handle\('deepseek-optimize-layout'/);
  assert.match(main, /hostname: 'api\.deepseek\.com'/);
  assert.match(main, /path: '\/chat\/completions'/);
  assert.match(main, /model: 'deepseek-v4-flash'/);
  assert.match(main, /content: `\$\{prompt\}\\n\\n\$\{content\}`/);
  assert.match(main, /Authorization: `Bearer \$\{apiKey\}`/);
});

test('AI menu translates the active editor content to Chinese or English', () => {
  assert.match(
    main,
    /label: 'AI 翻译'[\s\S]*label: '中文'[\s\S]*sendToActiveWindow\('ai-translate', 'zh'\)/
  );
  assert.match(
    main,
    /label: 'AI 翻译'[\s\S]*label: '英文'[\s\S]*sendToActiveWindow\('ai-translate', 'en'\)/
  );
  assert.match(main, /ipcMain\.handle\('deepseek-translate'/);
  assert.match(main, /请将以下内容在中文和英文之间进行翻译/);
  assert.match(main, /请直接输出翻译结果，不需要解释翻译过程/);
});

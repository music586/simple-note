const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('main process persists independent provider API Keys through validated IPC handlers', () => {
  assert.match(
    main,
    /const defaultDeepseekLayoutPrompt = '保证原文的内容，不要随意串改，优化下面的正文排版，'[\s\S]*'使用markdown 标签优化展示，和层级结构'/
  );
  assert.match(main, /ipcMain\.handle\('get-ai-settings'/);
  assert.match(main, /ipcMain\.handle\('set-ai-settings'/);
  assert.match(main, /typeof apiKey !== 'string'/);
  assert.match(main, /const keyName = `\$\{provider\}ApiKey`/);
  assert.match(main, /config\[keyName\] = normalizedApiKey/);
  assert.match(main, /delete config\[keyName\]/);
  assert.match(main, /config\.aiProvider = provider/);
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
  assert.match(main, /hostname: 'api\.deepseek\.com',[\s\S]*path: '\/chat\/completions'/);
  assert.match(main, /hostname: 'api\.xiaomimimo\.com'/);
  assert.match(main, /hostname: 'api\.xiaomimimo\.com',[\s\S]*path: '\/v1\/chat\/completions'/);
  assert.match(main, /model: 'mimo-v2\.5-pro'/);
  assert.match(main, /hostname: 'tokenhub\.tencentmaas\.com'/);
  assert.match(
    main,
    /hostname: 'tokenhub\.tencentmaas\.com',[\s\S]*path: '\/v1\/chat\/completions'/
  );
  assert.match(main, /model: 'hy3'/);
  assert.doesNotMatch(main, /model: 'hy3-preview'/);
  assert.doesNotMatch(main, /hostname: 'api\.hunyuan\.cloud\.tencent\.com'/);
  assert.match(main, /path: '\/chat\/completions'/);
  assert.match(main, /model: 'deepseek-v4-flash'/);
  assert.match(main, /content: `\$\{prompt\}\\n\\n\$\{content\}`/);
  assert.match(main, /Authorization: `Bearer \$\{apiKey\}`/);
  assert.equal((main.match(/path: provider\.path/g) || []).length, 2);
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

test('new AI API Keys are tested with one output token before saving', () => {
  assert.match(main, /ipcMain\.handle\('test-ai-api-key'/);
  assert.match(main, /max_completion_tokens: 1/);
  assert.match(main, /max_tokens: 1/);
  assert.match(main, /await testAiApiKey\(provider, normalizedApiKey\)/);
  assert.doesNotMatch(main, /console\.(?:log|info|debug)\([^)]*testAiApiKey/);
});

test('Hunyuan authentication failures explain how to replace an invalid API Key', () => {
  assert.match(main, /providerId === 'hunyuan' && statusCode === 401/);
  assert.match(main, /腾讯混元 TokenHub API Key 无效或已失效/);
  assert.match(main, /Hy3 开启免费体验或后付费/);
  assert.equal((main.match(/data\?\.error\?\.message_zh \|\| data\?\.error\?\.message/g) || []).length, 2);
  assert.equal((main.match(/getAiProviderHttpError\(/g) || []).length, 3);
});

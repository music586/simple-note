const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

test('AI translation uses the selection when present and otherwise the full note', () => {
  assert.match(renderer, /async function translateActiveNote\(targetLanguage\)/);
  assert.match(renderer, /const selectionOnly = selectionEnd > selectionStart/);
  assert.match(
    renderer,
    /ipcRenderer\.invoke\('deepseek-translate', \{[\s\S]*targetLanguage,[\s\S]*content: originalContent/
  );
  assert.match(renderer, /targetEditor\.setRangeText\(translatedContent, selectionStart, selectionEnd\)/);
  assert.match(renderer, /targetEditor\.value = translatedContent/);
  assert.match(renderer, /ipcRenderer\.on\('ai-translate', \(event, targetLanguage\)/);
});

test('AI translation saves content without setting the layout stamp state', () => {
  const translationFunction = renderer.match(
    /async function translateActiveNote\(targetLanguage\) \{([\s\S]*?)\n\}\n\nmodalCancel/
  );
  assert.ok(translationFunction);
  assert.match(translationFunction[1], /await saveCurrentNote(?:Right)?\(\)/);
  assert.doesNotMatch(translationFunction[1], /set-ai-optimized-state/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('settings dialog shows a read-only image directory chooser', () => {
  for (const id of [
    'settingsModal', 'imageDirectoryPath', 'imageDirectoryMode',
    'imageDirectoryChoose', 'imageDirectoryReset', 'settingsError'
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="settingsClose"|id="settingsDone"/);
  assert.doesNotMatch(html, /id="imageDirectoryPath"[^>]*<input/);
});

test('settings dialog is driven by image directory IPC', () => {
  assert.match(renderer, /ipcRenderer\.on\('open-settings'/);
  assert.match(renderer, /ipcRenderer\.invoke\('get-image-directory'\)/);
  assert.match(renderer, /ipcRenderer\.invoke\('select-image-directory'\)/);
  assert.match(renderer, /ipcRenderer\.invoke\('reset-image-directory'\)/);
});

test('settings dialog uses the centered modal system', () => {
  assert.match(styles, /\.settings-modal-content\s*\{/);
  assert.match(styles, /\.image-directory-path\s*\{/);
});

test('settings dialog groups directory controls into responsive setting cards', () => {
  assert.equal((html.match(/class="settings-card"/g) || []).length, 3);
  assert.match(html, /class="settings-kicker">简记偏好/);
  assert.match(styles, /\.settings-modal-content::before\s*\{/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('settings dialog supports local DeepSeek API Key configuration', () => {
  assert.match(html, /<strong>AI 设置<\/strong>/);
  assert.match(html, /目前仅支持 DeepSeek，其他模型后续开放。/);
  assert.match(html, /id="deepseekApiKey"[^>]*type="password"/);
  assert.match(html, /id="deepseekLayoutPrompt"[^>]*class="settings-prompt-input"/);
  assert.match(html, /API Key 仅保存在当前设备的本地配置中。/);
  assert.match(html, /调用时将在提示词后附加当前笔记的全部内容。/);
  assert.match(renderer, /ipcRenderer\.invoke\('get-ai-settings'\)/);
  assert.match(renderer, /ipcRenderer\.invoke\('set-ai-settings'/);
  assert.match(styles, /\.settings-api-key-input\s*\{/);
  assert.match(styles, /\.settings-prompt-input\s*\{/);
  assert.match(styles, /\.settings-modal-body\s*\{[^}]*overflow-y: auto;/s);
});

test('AI layout result replaces and saves the active editor content', () => {
  assert.match(renderer, /ipcRenderer\.on\('ai-optimize-layout', optimizeActiveNoteLayout\)/);
  assert.match(
    renderer,
    /ipcRenderer\.invoke\('deepseek-optimize-layout', originalContent\)/
  );
  assert.match(renderer, /targetEditor\.value = normalizeAiMarkdownResponse\(result\.content\)/);
  assert.match(renderer, /updatePreviewRight\(true\);[\s\S]*saveCurrentNoteRight\(\)/);
  assert.match(renderer, /updatePreview\(true\);[\s\S]*saveCurrentNote\(\)/);
  assert.match(renderer, /currentTargetNote\.path !== targetNote\.path/);
});

test('AI request displays estimated progress only in the active editor panel', () => {
  assert.match(html, /id="aiProgress"[^>]*role="progressbar"/);
  assert.match(html, /aria-label="AI 优化排版预计进度"/);
  assert.match(styles, /\.ai-progress\s*\{[^}]*position: absolute;[^}]*inset: 0 0 auto;/s);
  assert.match(styles, /\.ai-progress-bar\s*\{[^}]*transition: width 0\.4s ease-out;/s);
  assert.match(renderer, /function startAiProgress\(editorAdapter\)/);
  assert.match(
    renderer,
    /const panel = editorAdapter === editorRight \? rightPanel : leftPanel;[\s\S]*panel\.appendChild\(aiProgress\)/
  );
  assert.match(renderer, /Math\.min\(92, estimated\)/);
  assert.match(renderer, /setAiProgress\(100\)/);
  assert.match(
    renderer,
    /aiLayoutBusy = true;[\s\S]*startAiProgress\(targetEditor\);[\s\S]*finishAiProgress\(completed\)/
  );
});

test('settings dialog handles rejected IPC with visible Chinese errors', () => {
  assert.match(renderer, /function getSettingsErrorMessage\(/);
  assert.match(renderer, /设置加载失败/);
  assert.match(renderer, /选择图片目录失败/);
  assert.match(renderer, /恢复默认目录失败/);
  assert.match(renderer, /try\s*\{[\s\S]*ipcRenderer\.invoke\('get-image-directory'\)/);
});

test('settings dialog owns keyboard focus while open', () => {
  assert.match(renderer, /settingsPreviousFocus = document\.activeElement/);
  assert.match(renderer, /imageDirectoryChoose\.focus\(\)/);
  assert.match(renderer, /settingsModal\.querySelectorAll\(/);
  assert.match(renderer, /event\.stopImmediatePropagation\(\)/);
  assert.match(renderer, /document\.addEventListener\('keydown',[\s\S]*true\);/);
});

test('settings dialog prevents stale and duplicate directory requests', () => {
  assert.match(renderer, /settingsRequestId/);
  assert.match(renderer, /requestId !== settingsRequestId/);
  assert.match(renderer, /setSettingsBusy\(true\)/);
  assert.match(renderer, /if \(settingsBusy\) return/);
});

test('settings dialog clears stale directory state before loading', () => {
  assert.match(renderer, /function resetImageDirectorySettings\(\)/);
  assert.match(renderer, /imageDirectoryPath\.textContent = ''/);
  assert.match(renderer, /imageDirectoryMode\.textContent = '正在加载…'/);
  assert.match(renderer, /settingsIsCustom = false/);
  assert.match(renderer, /resetImageDirectorySettings\(\);[\s\S]*get-image-directory/);
});

test('failed custom directory loads enable recovery actions', () => {
  assert.match(renderer, /function renderFailedImageDirectorySettings\(result\)/);
  assert.match(renderer, /renderImageDirectorySettings\(result\)/);
  assert.match(renderer, /if \(result\.isCustom && result\.effectivePath\)/);
});

test('picker cancellation keeps an invalid directory error visible', () => {
  assert.match(renderer, /if \(result\.canceled && result\.error\)/);
  assert.match(renderer, /getSettingsErrorMessage\('当前目录不可用', result\.error\)/);
});

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('AI layout review sessions persist and can be resumed from the application menu', () => {
  assert.match(main, /ipcMain\.handle\('get-ai-review-session'/);
  assert.match(main, /ipcMain\.handle\('set-ai-review-session'/);
  assert.match(main, /ipcMain\.handle\('delete-ai-review-session'/);
  assert.match(main, /label: '继续审阅 AI 排版…'/);
  assert.match(renderer, /ipcRenderer\.on\('ai-resume-layout-review'/);
  assert.match(renderer, /async function resumeAiReview\(\)/);
});

test('accepted review chunks are tracked while ignored chunks update the candidate document', () => {
  assert.match(renderer, /acceptedSignatures: new Set\(\)/);
  assert.match(renderer, /aiReviewState\.acceptedSignatures\.add/);
  assert.match(renderer, /function rejectCurrentAiReviewChunk\(\)/);
  assert.match(renderer, /userEvent: 'ai-review\.ignore'/);
  assert.match(renderer, /cm-ai-review-accepted/);
});

test('closing a review exposes resumable controls without applying the candidate', () => {
  assert.match(html, /id="aiReviewPendingOpen"[^>]*>继续审阅</);
  assert.match(html, /id="aiReviewPendingDiscard"[^>]*>放弃</);
  assert.match(renderer, /function closeAiReview\(\{ persist = true \} = \{\}\)/);
  assert.match(renderer, /showAiReviewPending\(targetEditor, pendingCount\)/);
});

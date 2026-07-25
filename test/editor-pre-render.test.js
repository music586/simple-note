const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(
  path.join(__dirname, '..', 'renderer.js'),
  'utf8'
);

test('pre-render determines fenced code state independently for every visible line', () => {
  assert.match(
    renderer,
    /const containingCodeBlock = codeBlocks\.find\(block => \([\s\S]*block\.start <= lineNumber[\s\S]*block\.end >= lineNumber/
  );
  assert.match(
    renderer,
    /const inCodeFence = Boolean\(containingCodeBlock && !fenceLine\)/
  );
  assert.doesNotMatch(renderer, /let inCodeFence = codeBlocks\.some/);
  assert.doesNotMatch(renderer, /inCodeFence = !inCodeFence/);
});

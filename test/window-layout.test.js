const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('macOS traffic lights are centered in the compact top bar', () => {
  assert.match(main, /trafficLightPosition: \{ x: 18, y: 15 \}/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  scheduleDecorationHeightChange
} = require('../editor-widget-height');

const renderer = fs.readFileSync(
  path.join(__dirname, '..', 'renderer.js'),
  'utf8'
);
const packageJson = require('../package.json');

test('在下一动画帧通知仍然有效的装饰重新测量高度', () => {
  let callback;
  let changedCount = 0;
  const decoration = {
    changed: () => {
      changedCount += 1;
    }
  };

  scheduleDecorationHeightChange(
    () => decoration,
    {
      getScrollInfo: () => ({ top: 0 }),
      scrollTo: () => {}
    },
    next => {
      callback = next;
    }
  );

  assert.equal(changedCount, 0);
  callback();
  assert.equal(changedCount, 1);
});

test('装饰清除后不再通知高度变化', () => {
  let callback;

  scheduleDecorationHeightChange(
    () => null,
    {},
    next => {
      callback = next;
    }
  );

  assert.doesNotThrow(() => callback());
});

test('装饰高度变化后恢复 CodeMirror 原滚动位置', () => {
  let callback;
  let scrollTop = 320;
  const codeMirror = {
    getScrollInfo: () => ({ top: scrollTop }),
    scrollTo: (left, top) => {
      assert.equal(left, null);
      scrollTop = top;
    }
  };
  const decoration = {
    changed: () => {
      scrollTop = 440;
    }
  };

  scheduleDecorationHeightChange(
    () => decoration,
    codeMirror,
    next => {
      callback = next;
    }
  );

  callback();
  assert.equal(scrollTop, 320);
});

test('高度变化未引起滚动时不重复设置滚动位置', () => {
  let callback;
  let restoreCount = 0;
  const codeMirror = {
    getScrollInfo: () => ({ top: 320 }),
    scrollTo: () => {
      restoreCount += 1;
    }
  };

  scheduleDecorationHeightChange(
    () => ({ changed: () => {} }),
    codeMirror,
    next => {
      callback = next;
    }
  );

  callback();
  assert.equal(restoreCount, 0);
});

test('图片完成加载后通知对应装饰高度变化', () => {
  assert.match(renderer, /image\.addEventListener\('load', notifyHeightChange\)/);
  assert.match(renderer, /image\.addEventListener\('error', notifyHeightChange\)/);
});

test('代码块挂载后通知替换标记高度变化', () => {
  assert.match(
    renderer,
    /scheduleDecorationHeightChange\(\(\) => \{\s+return editorAdapter\.decorationMarks\.includes\(codeMark\)/
  );
});

test('图片装饰清除后不再触发旧部件的高度变化', () => {
  assert.match(
    renderer,
    /return editorAdapter\.decorationWidgets\.includes\(imageDecoration\)/
  );
  assert.match(
    renderer,
    /return editorAdapter\.decorationMarks\.includes\(imageDecoration\)/
  );
});

test('预渲染高度同步不使用全局刷新', () => {
  assert.doesNotMatch(
    renderer,
    /(?:notifyHeightChange|codeMark)[\s\S]{0,160}codeMirror\.refresh\(/
  );
});

test('打包文件包含预渲染高度同步模块', () => {
  assert.ok(packageJson.build.files.includes('editor-widget-height.js'));
});

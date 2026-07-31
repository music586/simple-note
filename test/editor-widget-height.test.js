const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  captureEditorScrollAnchor,
  restoreEditorScrollAnchor,
  preserveEditorScrollPosition,
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

test('装饰高度变化后保持视口顶部可见行的位置', () => {
  let scrollTop = 320;
  let anchorLineTop = 300;
  const codeMirror = {
    getScrollInfo: () => ({ top: scrollTop }),
    getViewport: () => ({ from: 12, to: 30 }),
    heightAtLine: line => {
      assert.equal(line, 12);
      return anchorLineTop;
    },
    scrollTo: (left, top) => {
      assert.equal(left, null);
      scrollTop = top;
    }
  };

  const anchor = captureEditorScrollAnchor(codeMirror);
  anchorLineTop = 380;
  restoreEditorScrollAnchor(codeMirror, anchor);

  assert.equal(scrollTop, 400);
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

test('聚焦引起整体高度变化时保持视口顶部不变区域的位置', () => {
  const frames = [];
  let scrollTop = 320;
  let anchorLineTop = 300;
  const codeMirror = {
    getScrollInfo: () => ({ top: scrollTop }),
    getViewport: () => ({ from: 12, to: 30 }),
    heightAtLine: () => anchorLineTop,
    scrollTo: (left, top) => {
      assert.equal(left, null);
      scrollTop = top;
    }
  };

  preserveEditorScrollPosition(codeMirror, () => {
    anchorLineTop = 460;
    scrollTop = 520;
  }, next => frames.push(next));

  assert.equal(scrollTop, 480);
  anchorLineTop = 500;
  frames.shift()();
  assert.equal(scrollTop, 520);
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

test('所有编辑器装饰重算统一保持滚动锚点', () => {
  assert.match(
    renderer,
    /preserveEditorScrollPosition\(codeMirror, \(\) => \{\s+codeMirror\.operation/
  );
});

test('光标状态不影响预渲染时跳过装饰重建和滚动调整', () => {
  assert.match(renderer, /function getEditorDecorationCursorState\(editorAdapter\)/);
  assert.match(renderer, /return hasSourceVisibilityChange \? `line:\$\{cursor\.line\}` : 'stable'/);
  assert.match(renderer, /const codeBlock = structure[\s\S]*findContainingCodeBlock/);
  assert.match(renderer, /function scheduleCursorEditorDecorations\(editorAdapter, getNote\)/);
  assert.match(
    renderer,
    /editorAdapter\.decorationCursorState === nextState\s+\) return;/
  );
  assert.match(
    renderer,
    /on\('cursorActivity',[\s\S]*scheduleCursorEditorDecorations\(editor,/
  );
  assert.match(
    renderer,
    /on\('cursorActivity',[\s\S]*scheduleCursorEditorDecorations\(editorRight,/
  );
});

test('点击编辑器空白区域只聚焦而不移动光标或触发重绘', () => {
  assert.match(
    renderer,
    /codeMirrorWrapper\.addEventListener\('mousedown', event => \{[\s\S]*\}, true\)/
  );
  assert.match(renderer, /if \(event\.target\.closest\('\.CodeMirror-line'\)\) return/);
  assert.match(renderer, /event\.preventDefault\(\);\s+inputField\.focus\(\{ preventScroll: true \}\)/);
});

test('滚动停稳后再更新视口装饰', () => {
  assert.match(renderer, /function scheduleViewportEditorDecorations/);
  assert.match(renderer, /decorationViewportTimer = setTimeout\([\s\S]*}, 100\)/);
  assert.match(
    renderer,
    /on\('viewportChange',[\s\S]*scheduleViewportEditorDecorations\(editor/
  );
});

test('视口在装饰缓冲范围内时复用现有装饰', () => {
  assert.match(renderer, /viewport\.from - 80/);
  assert.match(renderer, /viewport\.to \+ 80/);
  assert.match(
    renderer,
    /viewport\.from >= stableFrom && viewport\.to <= stableTo\) return/
  );
});

test('文档结构和代码高亮使用有界缓存', () => {
  assert.match(renderer, /function getCachedDecorationStructure/);
  assert.match(renderer, /if \(!editorAdapter\.decorationStructureDirty\)/);
  assert.match(renderer, /codeHighlightCache: new Map\(\)/);
  assert.match(renderer, /while \(cache\.size > 80\)/);
});

test('打包文件包含预渲染高度同步模块', () => {
  assert.ok(packageJson.build.files.includes('editor-widget-height.js'));
});

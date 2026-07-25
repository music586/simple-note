# 编辑器预渲染高度同步修复实现计划

**目标：** 图片或代码块预渲染改变高度后，CodeMirror 的点击命中、光标位置和滚动位置
仍与页面实际布局一致。

**架构：** 新建一个无 DOM 依赖的小模块，统一负责在下一动画帧调用 CodeMirror 装饰对象
的 `changed()`。调用前后比较所属编辑器的 `scrollTop`，如果 CodeMirror 因重测高度主动
滚动，则立即恢复原值；渲染器只使受影响的装饰高度失效，不刷新整个编辑器。

**技术栈：** CommonJS、CodeMirror 5、Node.js 内置测试运行器。

## 全局约束

- 使用普通 JavaScript 和 CommonJS。
- 保持 2 空格缩进、单引号、无尾随逗号。
- 不调用全局 `CodeMirror.refresh()`。
- 图片和代码块高度同步前后的编辑器 `scrollTop` 必须相同。
- 不改变图片、代码块的样式和既有交互。

---

### 任务 1：装饰高度失效调度器

**文件：**

- 新建：`editor-widget-height.js`
- 新建：`test/editor-widget-height.test.js`

**接口：**

- 输出：`scheduleDecorationHeightChange(getDecoration, requestFrame)`
- `getDecoration` 返回当前 `TextMarker`、`LineWidget` 或 `null`。
- `requestFrame` 默认为浏览器的 `requestAnimationFrame`，测试可注入替代实现。

- [ ] **步骤 1：先写失败测试**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scheduleDecorationHeightChange
} = require('../editor-widget-height');

test('在下一动画帧通知仍然有效的装饰重新测量高度', () => {
  let callback;
  let changedCount = 0;
  const decoration = { changed: () => { changedCount += 1; } };

  scheduleDecorationHeightChange(
    () => decoration,
    next => { callback = next; }
  );

  assert.equal(changedCount, 0);
  callback();
  assert.equal(changedCount, 1);
});

test('装饰清除后不再通知高度变化', () => {
  let callback;

  scheduleDecorationHeightChange(
    () => null,
    next => { callback = next; }
  );

  assert.doesNotThrow(() => callback());
});
```

- [ ] **步骤 2：运行测试并确认因模块不存在而失败**

运行：`node --test test/editor-widget-height.test.js`

预期：失败，错误包含 `Cannot find module '../editor-widget-height'`。

- [ ] **步骤 3：实现最小调度器**

```javascript
function scheduleDecorationHeightChange(
  getDecoration,
  requestFrame = requestAnimationFrame
) {
  requestFrame(() => {
    const decoration = getDecoration();
    if (typeof decoration?.changed === 'function') decoration.changed();
  });
}

module.exports = {
  scheduleDecorationHeightChange
};
```

- [ ] **步骤 4：运行单元测试**

运行：`node --test test/editor-widget-height.test.js`

预期：2 项测试全部通过。

### 任务 2：接入图片和代码块预渲染

**文件：**

- 修改：`renderer.js:1-30, 1389-1535, 1590-1655, 1815-1910`
- 修改：`test/editor-widget-height.test.js`

**接口：**

- 使用任务 1 的
  `scheduleDecorationHeightChange(() => decoration)`。

- [ ] **步骤 1：增加渲染器接入的失败测试**

在 `test/editor-widget-height.test.js` 中读取 `renderer.js`，断言：

```javascript
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(
  path.join(__dirname, '..', 'renderer.js'),
  'utf8'
);

test('图片完成加载后通知对应装饰高度变化', () => {
  assert.match(renderer, /image\.addEventListener\('load', notifyHeightChange\)/);
  assert.match(renderer, /image\.addEventListener\('error', notifyHeightChange\)/);
});

test('代码块挂载后通知替换标记高度变化', () => {
  assert.match(
    renderer,
    /scheduleDecorationHeightChange\(\(\) => codeMark\)/
  );
});

test('预渲染高度同步不使用全局刷新', () => {
  assert.doesNotMatch(
    renderer,
    /(?:notifyHeightChange|codeMark)[\s\S]{0,160}codeMirror\.refresh\(/
  );
});
```

- [ ] **步骤 2：运行测试并确认接入断言失败**

运行：`node --test test/editor-widget-height.test.js`

预期：调度器测试通过，图片和代码块接入测试失败。

- [ ] **步骤 3：接入代码块**

在 `renderer.js` 导入调度器。创建 `codeMark` 后执行：

```javascript
scheduleDecorationHeightChange(() => codeMark);
```

- [ ] **步骤 4：接入图片**

让 `createImageWidget` 接收 `notifyHeightChange`。在设置 `image.src` 前注册：

```javascript
image.addEventListener('load', notifyHeightChange);
image.addEventListener('error', notifyHeightChange);
```

非活动图片使用闭包保存其 `TextMarker`，活动图片使用闭包保存其 `LineWidget`：

```javascript
let imageDecoration;
const widget = createImageWidget(match, () => {
  scheduleDecorationHeightChange(() => imageDecoration);
});
imageDecoration = addMark(from, to, {
  replacedWith: widget,
  atomic: true,
  handleMouseEvents: true
});
```

活动图片将最后一行替换为：

```javascript
imageDecoration = codeMirror.addLineWidget(lineNumber, widget, {
  above: false,
  coverGutter: false,
  noHScroll: true
});
```

- [ ] **步骤 5：运行定向测试**

运行：`node --test test/editor-widget-height.test.js`

预期：5 项测试全部通过。

- [ ] **步骤 6：运行完整验证**

运行：

```bash
npm test
node --check renderer.js
node --check editor-widget-height.js
git diff --check
```

预期：全部退出码为 0，无语法错误或空白错误。

- [ ] **步骤 7：人工验证**

启动应用后，在普通单栏编辑器中打开一篇包含大图片和多行围栏代码块的笔记。等待图片
加载完成，然后点击各预渲染部件下方的多行文本。

预期：滚动条不跳动，光标落在点击的文本行和字符附近。

### 任务 3：高度同步时锁定编辑器滚动位置

**文件：**

- 修改：`editor-widget-height.js`
- 修改：`renderer.js`
- 修改：`test/editor-widget-height.test.js`

**接口：**

- 将接口改为
  `scheduleDecorationHeightChange(getDecoration, codeMirror, requestFrame)`。
- `codeMirror` 提供 `getScrollInfo()` 和 `scrollTo(left, top)`。

- [ ] **步骤 1：先写滚动锁定失败测试**

```javascript
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
```

- [ ] **步骤 2：运行定向测试并确认失败**

运行：`node --test test/editor-widget-height.test.js`

预期：新增测试失败，因为现有函数把 `codeMirror` 当作动画帧调度器。

- [ ] **步骤 3：实现滚动位置恢复**

```javascript
function scheduleDecorationHeightChange(
  getDecoration,
  codeMirror,
  requestFrame = requestAnimationFrame
) {
  requestFrame(() => {
    const decoration = getDecoration();
    if (typeof decoration?.changed !== 'function') return;

    const scrollTop = codeMirror.getScrollInfo().top;
    decoration.changed();
    if (codeMirror.getScrollInfo().top !== scrollTop) {
      codeMirror.scrollTo(null, scrollTop);
    }
  });
}
```

- [ ] **步骤 4：所有渲染器调用传入所属 `codeMirror`**

```javascript
scheduleDecorationHeightChange(() => {
  return editorAdapter.decorationMarks.includes(codeMark) ? codeMark : null;
}, codeMirror);
```

图片的 `TextMarker` 和 `LineWidget` 调用同样传入当前 `codeMirror`。

- [ ] **步骤 5：运行完整验证**

运行：

```bash
npm test
node --check renderer.js
node --check editor-widget-height.js
git diff --check
```

预期：全部退出码为 0，且滚动锁定回归测试通过。

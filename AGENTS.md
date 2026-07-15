# AGENTS.md

本文档为在本仓库中工作的智能编码代理提供指导。

## 项目概述

这是一个使用 Electron 构建的桌面 Markdown 笔记应用，主要功能包括：

- Markdown 编辑与实时预览
- 代码块语法高亮
- 基于文件夹的笔记组织
- 双栏编辑，可并排对比两篇笔记
- 支持多个应用窗口
- 深色/浅色主题、纯阅读模式和禅模式
- 从剪贴板粘贴图片或文件，并存储为本地资源
- 可保存、切换和管理多个笔记目录及目录别名
- 在系统文件管理器中定位笔记和文件夹
- 中文用户界面

## 构建、检查和测试命令

```bash
npm start          # 启动 Electron 应用
npm run dev        # 以开发模式启动
npm run dist:mac   # 构建通用架构的 macOS DMG
```

`npm start` 和 `npm run dev` 都使用 `scripts/launch.js`。在 macOS 上，该脚本会准备并
启动位于 `.electron/简记.app` 的开发版应用，以保证应用名称、Bundle ID 和图标正确。

当前未配置代码检查或测试框架。修改 JavaScript 或格式后，使用以下轻量检查：

```bash
node --check main.js
node --check renderer.js
node --check about.js
git diff --check
```

## 重启要求

- 修改 `main.js`、`package.json`、`scripts/launch.js`、Electron 窗口或菜单配置、
  IPC 处理器以及应用启动行为后，需要重启 Electron 应用。
- 仅修改渲染进程代码时，刷新页面可能即可生效；如不能确定，尤其是同时修改了主进程
  和渲染进程文件时，应重启应用。
- 如果完成的修改需要重启，最终回复中必须明确提醒用户重启服务或应用后才能生效。
- 不得假设用户知道需要重启；必须主动、清楚地提供重启提醒。

## 代码风格规范

### 导入

使用 CommonJS（`require`）。导入顺序：Node.js 内置模块 → Electron 模块 → 第三方包。

```javascript
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { marked } = require('marked');
const hljs = require('highlight.js');
```

### 格式

- 使用 2 个空格缩进
- 字符串使用单引号
- 不使用尾随逗号
- 每行最多约 100 个字符
- 在逻辑区块之间添加空行

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 变量/函数 | camelCase | `currentNote`、`loadTree()` |
| 常量 | camelCase 或 SCREAMING_SNAKE_CASE | `configPath`、`MAX_RETRIES` |
| CSS 类 | kebab-case | `tree-folder`、`btn-icon` |
| CSS 变量 | 使用 `--` 前缀 | `--bg-primary` |
| HTML 元素 ID | camelCase | `notesList`、`modalInput` |
| IPC 通道 | kebab-case | `get-notes-dir`、`save-note` |

### 类型

使用普通 JavaScript，不使用 TypeScript。需要类型提示时可使用 JSDoc。IPC 处理器应在
运行时校验输入。

### 错误处理

```javascript
// 主进程
ipcMain.handle('some-action', async (event, data) => {
  try {
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 渲染进程
const result = await ipcRenderer.invoke('some-action', data);
if (!result.success) showConfirm('操作失败', result.error, () => {});
```

### 文件操作

执行文件操作前检查文件是否存在。主进程中使用同步操作：

```javascript
if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
fs.writeFileSync(filePath, content, 'utf-8');
```

### CSS 规范

- 在 `:root` 中定义用于主题的 CSS 自定义属性
- 使用语义化名称，例如 `--bg-primary`、`--text-secondary`
- 使用 Flexbox 布局

### IPC 通信

```javascript
// 主进程处理器
ipcMain.handle('action-name', async (event, param) => { return result; });

// 渲染进程调用
const result = await ipcRenderer.invoke('action-name', param);

// 单向通信（主进程 → 渲染进程）
mainWindow.webContents.send('event-name', data);
ipcRenderer.on('event-name', (event, data) => { });
```

### UI 文本

保持中文界面，例如：新建笔记、删除、确定、取消、笔记列表、重命名、移动失败、
确定要删除笔记吗？

### 状态管理

模块级变量：`let currentNote = null;`

使用 localStorage 持久化 UI 状态：
`localStorage.setItem('sidebar-hidden', sidebarHidden);`

主进程负责文件系统访问、应用窗口、原生菜单、模式和上下文菜单。渲染进程负责笔记和
编辑器界面。在多窗口代码中，应操作当前聚焦的 `BrowserWindow`，不得假设最后创建的
窗口就是当前活动窗口。

### 异步模式

统一使用 async/await：

```javascript
async function loadTree() {
  tree = await ipcRenderer.invoke('get-tree');
  renderTree();
}
```

### 安全

- 清理用户输入，参考 `escapeHtml` 函数
- 校验文件路径，防止目录遍历攻击
- 为简化实现，当前使用 `nodeIntegration: true`

## 项目结构

```text
note/
├── main.js           # Electron 主进程、IPC、窗口、菜单和文件系统
├── renderer.js       # 渲染进程 UI、编辑器状态和 Markdown 渲染
├── index.html        # 主窗口结构
├── styles.css        # 主窗口样式和主题
├── about.html        # 关于窗口结构
├── about.css         # 关于窗口样式
├── about.js          # 关于窗口版本信息显示
├── scripts/
│   └── launch.js     # 开发启动器和 macOS 应用准备逻辑
├── icon.png          # 运行时应用图标
├── icon.icns         # macOS Bundle 图标
├── package.json      # 脚本、依赖和 electron-builder 配置
└── AGENTS.md         # 代理指导文档
```

## 主要依赖

- **electron**（^28.0.0）：桌面应用框架
- **marked**（^11.0.0）：Markdown 解析器
- **highlight.js**（^11.9.0）：代码块语法高亮

## 注意事项

1. 项目结构简单，没有复杂的工具链
2. 主要源文件都位于根目录，没有 `src/` 文件夹
3. 当前没有测试基础设施
4. 应保持中文 UI 文本
5. 笔记以 `.md` 文件形式存储；多个目录配置保存在 `notesLocations` 中，`notesDir`
   表示当前活动目录
6. 根目录的 `assets` 文件夹以及所有 `.obsidian` 文件夹不会显示在笔记目录树中
7. 新建笔记和新建文件夹功能位于菜单和上下文菜单中，侧栏顶部没有对应按钮
8. 主进程修改通常需要完整重启应用，仅刷新页面不能生效

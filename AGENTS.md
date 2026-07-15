# AGENTS.md

This document provides guidance for agentic coding agents working in this repository.

## Project Overview

A desktop markdown note-taking application built with Electron featuring:
- Markdown editing with live preview
- Syntax highlighting for code blocks
- Folder-based note organization
- Dual-pane editing (compare two notes side-by-side)
- Chinese UI

## Build/Lint/Test Commands

```bash
npm start          # Start Electron app
npm run dev        # Start in development mode
npm run lint       # Run ESLint (recommended, not configured)
npm run lint:fix   # Auto-fix linting issues (recommended, not configured)
npm test           # Run all tests (recommended, not configured)
npm test -- path/to/test.js  # Run a single test file
```

Note: No build step required. No lint/test framework currently configured.

## Code Style Guidelines

### Imports

Use CommonJS (require). Order: Node.js built-ins → Electron modules → Third-party packages.

```javascript
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { marked } = require('marked');
const hljs = require('highlight.js');
```

### Formatting

- 2-space indentation
- Single quotes for strings
- No trailing commas
- Max line length: ~100 characters
- Blank lines between logical sections

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Variables/Functions | camelCase | `currentNote`, `loadTree()` |
| Constants | camelCase or SCREAMING_SNAKE_CASE | `configPath`, `MAX_RETRIES` |
| CSS classes | kebab-case | `tree-folder`, `btn-icon` |
| CSS variables | `--` prefix | `--bg-primary` |
| HTML element IDs | camelCase | `notesList`, `modalInput` |
| IPC channels | kebab-case | `get-notes-dir`, `save-note` |

### Types

Plain JavaScript without TypeScript. Use JSDoc for type hints when helpful. Validate inputs at runtime for IPC handlers.

### Error Handling

```javascript
// Main process
ipcMain.handle('some-action', async (event, data) => {
  try {
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Renderer
const result = await ipcRenderer.invoke('some-action', data);
if (!result.success) showConfirm('操作失败', result.error, () => {});
```

### File Operations

Check existence before operations. Use sync operations in main process:

```javascript
if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
fs.writeFileSync(filePath, content, 'utf-8');
```

### CSS Conventions

- CSS custom properties in `:root` for theming
- Semantic names: `--bg-primary`, `--text-secondary`
- Flexbox for layouts

### IPC Communication

```javascript
// Main process handler
ipcMain.handle('action-name', async (event, param) => { return result; });

// Renderer process
const result = await ipcRenderer.invoke('action-name', param);

// One-way (main -> renderer)
mainWindow.webContents.send('event-name', data);
ipcRenderer.on('event-name', (event, data) => { });
```

### UI Text

Maintain Chinese UI: 新建笔记, 删除, 确定, 取消, 笔记列表, 重命名, 移动失败, 确定要删除笔记吗？

### State Management

Module-level variables: `let currentNote = null;`
Persist UI state in localStorage: `localStorage.setItem('sidebar-hidden', sidebarHidden);`

### Async Patterns

Use async/await consistently:

```javascript
async function loadTree() {
  tree = await ipcRenderer.invoke('get-tree');
  renderTree();
}
```

### Security

- Sanitize user input (see `escapeHtml` function)
- Validate file paths to prevent directory traversal
- Note: `nodeIntegration: true` is used for simplicity

## Project Structure

```
note/
├── main.js        # Electron main process (IPC handlers, window, menu)
├── renderer.js    # Renderer process (UI logic, markdown rendering)
├── index.html     # Main HTML structure
├── styles.css     # All CSS styling
├── package.json   # Project configuration and dependencies
└── AGENTS.md      # This file
```

## Key Dependencies

- **electron** (^28.0.0): Desktop application framework
- **marked** (^11.0.0): Markdown parser
- **highlight.js** (^11.9.0): Syntax highlighting for code blocks

## Notes

1. Simple project without extensive tooling
2. All source files in root directory (no src/ folder)
3. No test infrastructure exists yet
4. Chinese UI text should be maintained
5. Notes stored as `.md` files in configurable directory

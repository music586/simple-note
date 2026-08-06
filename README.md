# 简记

一款简洁、专注、本地优先的桌面 Markdown 笔记应用，基于 Electron 和 CodeMirror 6
构建。笔记以普通 `.md` 文件保存在用户选择的目录中，便于备份、迁移，也可以与
Git、云盘或其他 Markdown 工具配合使用。

[![Release](https://img.shields.io/github/v/release/music586/simple-note?display_name=tag&sort=semver)](https://github.com/music586/simple-note/releases)
[![Release Build](https://github.com/music586/simple-note/actions/workflows/release.yml/badge.svg)](https://github.com/music586/simple-note/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#许可证)

## 功能特性

- Markdown 编辑与实时预览
- CodeMirror 6 编辑器与代码块语法高亮
- 标题、列表、引用、任务列表、表格和代码块等快捷输入
- 数学公式、Mermaid 图表、Callout、Wiki 链接和 YAML Front Matter
- 文件夹式笔记管理，支持快速打开、重命名、移动和在 Finder 中定位
- 双栏编辑，可并排查看和编辑两篇笔记
- 多窗口与多笔记目录管理，支持目录别名和工作区恢复
- 自动保存、原子写入和笔记历史版本
- 从剪贴板粘贴图片或文件，并保存为本地资源
- 编辑器查找、文档大纲、折叠标题和行号显示
- 明亮、黑暗与跟随系统的外观模式，以及多套强调色
- 阅读模式、写作模式和 PDF 导出
- 可选的 DeepSeek AI 排版与中英文翻译
- 中文界面

## 下载与安装

前往 [Releases](https://github.com/music586/simple-note/releases) 下载对应架构的 macOS
安装包：

- Apple Silicon（M1/M2/M3/M4 等）：`arm64.dmg`
- Intel Mac：`x64.dmg`

打开 DMG 后，将“简记”拖入“应用程序”文件夹即可。

> 当前发布流程提供经过 ad-hoc 签名的 macOS 应用，尚未进行 Apple 公证。首次启动时，
> 如果 macOS 阻止打开，请在 Finder 中右键应用并选择“打开”，或前往“系统设置 →
> 隐私与安全性”确认打开。请只从本项目 Releases 页面下载安装包。

目前仓库未配置 Windows 和 Linux 安装包。

## 快速开始

1. 启动简记。
2. 选择一个文件夹作为笔记目录。
3. 通过“文件”菜单新建笔记或文件夹。
4. 在编辑区输入 Markdown，内容会自动保存到本地 `.md` 文件。

应用不会使用专有数据库保存正文。你可以直接用 Finder、Git 或其他同步工具管理笔记
目录。根目录中的 `assets` 文件夹和所有 `.obsidian` 文件夹默认不会显示在目录树中。

## 本地开发

### 环境要求

- macOS
- Node.js 20.19.0 或更高版本
- npm

### 安装依赖

```bash
git clone https://github.com/music586/simple-note.git
cd simple-note
npm ci
```

### 启动应用

```bash
npm start
```

开发模式也可以使用：

```bash
npm run dev
```

在 macOS 上，启动脚本会准备并运行 `.electron/简记.app`，确保开发版拥有正确的应用
名称、Bundle ID 和图标。

### 运行测试

```bash
npm test
```

修改 JavaScript 后，还可以执行轻量语法与格式检查：

```bash
node --check main.js
node --check renderer.js
node --check about.js
git diff --check
```

### 构建 macOS 安装包

同时构建 Apple Silicon 和 Intel 版本：

```bash
npm run dist:mac
```

也可以单独构建：

```bash
npm run dist:mac:arm64
npm run dist:mac:x64
```

构建产物位于 `dist/`。推送格式为 `vX.Y.Z` 的标签时，GitHub Actions 会校验版本、
运行测试、构建两个架构的 DMG，并创建 GitHub Release。

## 项目结构

```text
simple-note/
├── main.js                    # Electron 主进程、窗口、菜单和文件系统
├── renderer.js                # 编辑器、预览和界面状态
├── codemirror6-adapter.js     # CodeMirror 6 适配层
├── markdown-*.js              # Markdown 方言、结构和快捷编辑逻辑
├── note-history*.js           # 历史版本与差异比较
├── index.html                 # 主窗口结构
├── styles.css                 # 主界面样式和主题
├── export-reading.css         # PDF 导出样式
├── scripts/                   # 开发启动、诊断和构建辅助脚本
├── test/                      # Node.js 测试
└── .github/workflows/         # GitHub Actions 工作流
```

## 技术栈

- [Electron](https://www.electronjs.org/)
- [CodeMirror 6](https://codemirror.net/)
- [Marked](https://marked.js.org/)
- [highlight.js](https://highlightjs.org/)
- [KaTeX](https://katex.org/)
- [Mermaid](https://mermaid.js.org/)
- [DOMPurify](https://github.com/cure53/DOMPurify)

## 数据与隐私

- 笔记正文保存在用户选择的本地目录中。
- 应用配置、窗口状态和历史版本保存在 Electron 用户数据目录中。
- Markdown 预览内容会经过清理，外部链接由系统浏览器打开。
- AI 功能是可选项。启用后，请自行配置 DeepSeek API Key；需要处理的文本会发送给相应
  服务，请在使用前了解其隐私政策，不要提交敏感内容。

建议定期备份笔记目录。自动保存和历史版本不能替代独立备份。

## 参与贡献

欢迎通过 Issue 报告问题或提出建议，也欢迎提交 Pull Request。

提交代码前，请确认：

1. 改动范围清晰，并保持中文界面文案一致。
2. 文件系统操作和 IPC 输入经过必要校验。
3. `npm test` 和 `git diff --check` 均通过。
4. 涉及主进程、菜单、窗口或启动流程的修改已通过完整重启验证。
5. Pull Request 中说明改动动机、验证方式和可能影响。

报告缺陷时，建议附上 macOS 版本、Mac 架构、简记版本、复现步骤和必要的截图或日志。
请勿在公开 Issue 中提交 API Key、私人笔记或其他敏感信息。

## 许可证

项目在 `package.json` 中声明使用 MIT License。仓库补充独立的 `LICENSE` 文件后，
许可证全文将以该文件为准。

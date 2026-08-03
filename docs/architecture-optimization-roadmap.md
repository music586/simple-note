# 架构优化实施路线

日期：2026-08-02

## 已完成：第一期安全与数据可靠性

| 项目 | 状态 | 验证 |
|---|---|---|
| Markdown 预览 HTML 清理 | 已完成 | DOMPurify；Electron 恶意标签诊断通过 |
| 内容安全策略 CSP | 已完成 | 禁止外部脚本、对象、Frame、表单和页面基址 |
| 禁止笔记触发窗口导航 | 已完成 | `will-navigate` 与新窗口均被拦截 |
| 文件 IPC 路径边界 | 已完成 | 读写、创建、删除、重命名、移动统一校验 |
| 符号链接越界防护 | 已完成 | 自动测试覆盖笔记库外符号链接 |
| 文件名校验 | 已完成 | 禁止路径分隔符、遍历名称和控制字符 |
| 笔记类型及大小限制 | 已完成 | 只允许 `.md`，单篇最大 50MB |
| 原子保存 | 已完成 | 同目录临时文件写入后原子替换 |

当前仍保留 `nodeIntegration: true` 和 `contextIsolation: false`，因为渲染进程仍直接通过
CommonJS 加载编辑器及 Markdown 模块。切换到 preload 隔离前，需要先完成渲染入口打包或模块
边界重构，不能只修改 BrowserWindow 开关，否则现有渲染进程会无法启动。

## 第二期：状态与模块边界

| 项目 | 状态 | 说明 |
|---|---|---|
| 左右栏保存控制器 | 已完成 | `EditorPanePersistence` 统一快照、重命名和保存流程 |
| 保存串行与 revision | 已完成 | 同一栏严格串行，左右栏独立并发，排队保存跟随重命名路径 |
| Markdown 方言配置 | 已完成 | 高亮、数学、Wiki、Callout、Front Matter 已迁出 `renderer.js` |
| 阅读预览安全模块 | 已完成 | DOMPurify 配置及 KaTeX 样式白名单已独立 |
| 完整 `EditorPaneController` | 待实施 | 继续统一打开、预览、大纲和关闭流程 |
| 编辑区块识别与装饰模块 | 待实施 | 从 `renderer.js` 迁出 CM6 Decoration 构建 |

后续步骤：

1. 提取完整 `EditorPaneController`，统一左右编辑栏的打开、预览、大纲和关闭流程。
2. 将 Markdown 块识别、编辑装饰和阅读预览继续拆成独立模块。
3. 将设置、文件树、AI、工作区恢复从 `renderer.js` 迁出。
4. 将文件 IPC 注册和笔记库服务从 `main.js` 迁出。

## 第三期：Electron 完整隔离

1. 新增 `preload.js` 和白名单 API。
2. 渲染进程不再直接导入 Electron、Node.js `path`、`crypto` 等模块。
3. 设置 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
4. 校验 IPC 事件来源，只接受应用自身窗口。
5. 将 DeepSeek API Key 迁移到系统钥匙串。

## 第四期：CM6 原生增量渲染

1. 使用 `ViewPlugin` 和 `syntaxTree()` 生成行内及行结构装饰。
2. 使用 `DecorationSet.map(transaction.changes)` 保留未变化装饰。
3. 块组件按类型、内容哈希和主题缓存。
4. 逐步删除 CM5 风格适配 API。
5. 增加 1 万、5 万和 10 万行性能基准。

每期完成时必须运行完整单元测试、Electron 预渲染诊断、路径安全测试和 `git diff --check`。

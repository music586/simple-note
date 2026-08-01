# macOS DMG 包体积优化方案

日期：2026-08-01

## 当前情况

对仓库现有构建产物和依赖目录进行测量，结果如下：

| 项目                           |   大小    |
|:-------------------------------|:---------:|
| dist 目录                      | 约 917 MB |
| universal .app                 | 约 409 MB |
| Electron Framework             | 约 396 MB |
| 应用 Resources                 | 约 11 MB  |
| app.asar                       | 约 10 MB  |
| 单个旧版 universal DMG         | 约 169 MB |
| 本地 node_modules/mermaid      | 约 83 MB  |
| 本地 node_modules/highlight.js | 约 9.1 MB |

dist 总大小包含多个历史 DMG、blockmap 和未压缩的 .app，不能代表用户单次下载量。 当前单个旧版 universal DMG 约为 169 MB。

在未压缩应用中，Electron Framework 占 .app 总体积约 97%。因此包体积最大的来源是 同时包含 x64 和 arm64 的 Electron universal 运行时，而不是项目自身 JavaScript、CSS 或 图片资源。

现有 dist 产物早于 Mermaid 功能，后续应先构建当前版本，获得加入 Mermaid 后的真实 基线，再对各项优化进行前后对比。

## 方案一：按 CPU 架构拆分 DMG

### 做法

将当前 universal 配置：

    "arch": [
      "universal"
    ]

改为分别构建：

    "arch": [
      "arm64",
      "x64"
    ]

发布页面提供两个安装包：

    SimpleNote-1.1.6-arm64.dmg
    SimpleNote-1.1.6-x64.dmg

Apple Silicon 用户下载 arm64，Intel 用户下载 x64。

### 预期收益

- 单个 DMG 预计可由约 169 MB 降至约 90～110 MB；
- 解压后的 .app 体积接近减半；
- 不改变应用功能或渲染行为；
- 不需要重构业务代码。

实际大小需通过正式构建确认，以上数据是根据当前 universal Framework 体积作出的估算。

### 成本和风险

- 发布页面会出现两个安装包；
- 用户需要选择正确架构；
- GitHub Actions 应分别构建、命名和上传两个产物；
- 自动更新元数据需要按架构正确匹配；
- 如果未来加入原生 Node 模块，需要分别验证两个架构的二进制兼容性。

electron-builder 原生支持 x64、arm64 和 universal 架构：
[macOS 构建配置](https://www.electron.build/docs/mac/)、
[多架构构建说明](https://www.electron.build/docs/architecture/)。

### 结论

这是当前收益最大、改造风险最低的优化，应作为第一优先级。

## 方案二：只分发 Mermaid 浏览器 Bundle

### 当前问题

本地 node_modules/mermaid 约 83 MB，包含：

- 多种 ESM 和浏览器构建产物；
- source map；
- TypeScript 类型声明；
- 图表模块和动态 chunks；
- README、测试相关内容；
- D3、Cytoscape、KaTeX、marked 等依赖。

应用当前实际加载的是：

    mermaid/dist/mermaid.min.js

该文件约 3.4 MB。

### 做法

在构建或依赖更新阶段只复制需要的文件：

    vendor/mermaid.min.js
    vendor/mermaid-license.txt

运行时从应用资源加载该 bundle，不再通过 require.resolve(‘mermaid’) 定位整个 npm 包。 同时移除生产环境的完整 Mermaid 运行时依赖，或确保 electron-builder 不把其余内容打入 ASAR。

需要同步调整：

- Mermaid 脚本路径；
- Mermaid 版本信息来源；
- 许可证文件；
- Mermaid 更新脚本；
- 打包文件白名单；
- 开发环境和正式构建的一致性测试。

### 预期收益

预计可减少数 MB 到数十 MB，具体取决于当前版本 electron-builder 对 Mermaid 依赖树的 裁剪结果。应在构建 1.1.5 后解包 app.asar 测量，不能直接使用 node_modules 的 83 MB 作为最终节省量。

### 风险

- Mermaid 浏览器 bundle 的文件结构可能随版本变化；
- 必须保留和分发符合要求的许可证；
- 更新 Mermaid 时需要同步更新 vendor 文件和版本信息；
- 如果 bundle 依赖外部 chunks，必须一并打包并验证离线运行。

## 方案三：精简 highlight.js

### 当前问题

highlight.js 本地目录约 9.1 MB，包含全部语言、样式、SCSS、ESM 和 CommonJS 文件。 应用不需要这些文件的全部内容。

### 做法

使用核心包并只注册支持的语言：

    const hljs = require('highlight.js/lib/core');
    const javascript = require('highlight.js/lib/languages/javascript');
    const python = require('highlight.js/lib/languages/python');

    hljs.registerLanguage('javascript', javascript);
    hljs.registerLanguage('python', python);

语言集合应与代码块语言选择器保持一致。也可以在构建阶段通过 esbuild 生成只包含所需语言 的单一 bundle。

### 预期收益

预计节省数 MB。收益低于架构拆分和 Mermaid 精简，但实现相对独立。

### 风险

- 自动语言检测范围会缩小；
- 语言选择器、别名和注册项必须保持同步；
- 用户粘贴未注册语言时只能显示为纯文本或使用通用检测结果。

## 方案四：引入 esbuild 打包渲染进程

### 做法

使用 esbuild 将渲染进程及实际使用的依赖打包为少量文件：

    renderer.js + 实际引用的依赖
                  ↓
           renderer.bundle.js

构建过程可以完成：

- Tree Shaking；
- JavaScript 压缩；
- 删除未引用模块；
- 合并重复依赖；
- 避免把完整 npm 包目录放入 ASAR；
- 生成明确的生产文件清单。

### 预期收益

业务资源和 app.asar 会进一步缩小，Mermaid、highlight.js 等依赖的裁剪效果也更可控。 但 Electron Framework 仍然是总体积的主要部分，因此该方案不能代替架构拆分。

### 成本和风险

- 需要增加构建步骤和开发模式；
- Electron 的 CommonJS、Node 内置模块和动态资源路径需要配置；
- require.resolve(‘mermaid’) 等动态路径不能直接依赖 Tree Shaking；
- source map、错误堆栈和调试流程需要重新设置；
- 打包后必须验证 IPC、文件路径和 Electron 安全配置。

## 方案五：建立包体积审计

每次发布应记录以下数据：

    DMG 大小
    .app 大小
    Electron Framework 大小
    app.asar 大小
    app.asar 中最大的 20 个文件

建议为 CI 增加体积阈值，例如：

    arm64 DMG 不超过 110 MB
    x64 DMG 不超过 120 MB
    app.asar 不超过 20 MB

阈值应在完成一次真实的当前版本构建后，根据实际数据修正。

可以使用 ASAR 工具查看包内文件，结合 du 或脚本输出最大文件列表。包体报告应作为构建 日志或 GitHub Actions artifact 保存，便于发现新增依赖导致的体积回归。

## 不建议优先实施的方案

### 使用 maximum 压缩

electron-builder 默认使用 normal 压缩。官方文档说明 maximum 通常不会带来明显的体积
差异，但会增加构建时间。因此不建议将它作为主要优化手段：
[electron-builder macOS 压缩配置](https://www.electron.build/docs/mac/)。

### 只压缩业务源码和 CSS

当前业务 Resources 约 11 MB，而 Electron Framework 约 396 MB。即使将业务代码压缩几百 KB，对约 169 MB 的 universal DMG 影响也很有限。源码压缩可以在引入 esbuild 时顺带 完成，不应单独作为第一阶段项目。

### 仅为体积升级 Electron

升级 Electron 对安全和兼容性有价值，但不同 Electron 版本包含的 Chromium 和 V8 体积 不保证更小。Electron 升级应基于安全、功能和维护周期决策，不应视为稳定的包体优化手段。

### 为体积直接迁移 Tauri

Tauri 等系统 WebView 架构不随应用分发完整 Chromium，确实可以显著降低安装包体积， 但需要重写：

- Electron IPC；
- 文件系统能力；
- 原生菜单；
- 多窗口；
- 剪贴板和文件定位；
- macOS 全屏和窗口行为；
- 自动更新、签名和发布流程。

仅为减少 DMG 大小进行此类迁移，成本通常高于收益。如果未来同时需要更低内存占用、移动端 支持或安全沙箱重构，可以单独进行架构评估。

## 推荐实施顺序

1.  清理旧构建产物并构建当前版本，记录真实基线。
2.  解包并分析当前 app.asar，确认 Mermaid 和 highlight.js 的实际占用。
3.  将 universal DMG 拆分为 arm64 和 x64 两个安装包。
4.  调整 GitHub Actions、发布文件命名和自动更新元数据。
5.  只分发 Mermaid 所需的浏览器 bundle 和许可证。
6.  精简 highlight.js 语言集合。
7.  评估并引入 esbuild 渲染进程打包。
8.  在 CI 中加入包体积报告和阈值检查。

每完成一步都应重新记录 DMG、.app、Framework 和 app.asar 大小，使用同一环境比较， 避免把压缩方式、架构或缓存差异误认为代码优化收益。

## 最终建议

短期优先拆分 arm64 和 x64，这是对当前约 169 MB universal DMG 最有效、最安全的优化。 随后基于当前版本 ASAR 的真实数据精简 Mermaid 和 highlight.js。只有在业务资源成为主要 体积来源后，才值得投入完整的前端打包流程。

如果仍需同时提供 universal 安装包，可以将它作为兼容下载项保留，但默认推荐用户下载与 设备匹配的单架构版本。

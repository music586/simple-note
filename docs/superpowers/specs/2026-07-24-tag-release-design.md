# Tag 自动发布设计

## 目标

当仓库推送 `v*.*.*` 格式的 Git Tag 时，自动测试并构建 macOS 通用架构 DMG，
随后创建对应的 GitHub Release 并上传安装包。

## 设计

- 工作流只由语义版本 Tag 推送触发；失败的运行可从 GitHub Actions 页面重新运行。
- 使用 macOS GitHub 托管 Runner，以支持现有的 Electron macOS 构建。
- 安装依赖后先运行完整测试，失败时停止发布。
- Tag 去掉 `v` 后必须与 `package.json` 的 `version` 完全一致。
- 使用现有 `npm run dist:mac` 生成 `dist/*.dmg`。
- 使用 Runner 自带的 GitHub CLI 和仓库 `GITHUB_TOKEN` 创建 Release、自动生成说明并上传 DMG。
- `GITHUB_TOKEN` 仅授予发布所需的 `contents: write` 权限。

## 暂不包含

- Apple Developer 签名与公证
- Windows 或 Linux 安装包
- 自动修改版本号或创建 Tag

## 验证

- 源码测试检查触发条件、权限、版本校验、测试、构建和发布步骤。
- 运行完整 `npm test` 和 `git diff --check`。
- 实际发布由下一次推送符合规则且版本一致的 Tag 完成。

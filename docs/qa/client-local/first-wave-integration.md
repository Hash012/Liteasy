# 第一轮客户端集成验收

2026-10-02，在 `feat/client-first-wave-integration` 集成 C00、C02、C03、C08、C10、C11 的独立切片。范围和继续顺序见 [总览](README.md)；这不是整个任务包或三平台发布验收。

## 原文件真实闭环

使用隔离的 local-only 开发 profile，在 Ubuntu 24.04 x64 WSL2/WSLg、GTK 3.24.41 / WebKitGTK 2.52.6 下操作实际 Tauri 窗口。没有 dev-cloud、模型调用或私人资料。Node 为 22.13.1、Rust 为 1.98.0，与仓库要求的 22.23.2 / 1.98.1 有差异，未修改版本要求。

- 冷启动 argv 打开合成 PDF，热启动转交带中文和空格路径的 EPUB，再转交 PDF。PDF 使用实际 canvas/text layer，EPUB 在既有中央阅读器展示正文和目录；本地文献库条目数始终为 0。
- 在 PDF 中实际拖选 `WiWi`，点击高亮；关闭标签，再通过原位置打开，高亮仍存在。完整停止进程并重启，通过显式 argv 重新授权，同一 PDF 与高亮恢复。没有声称自动恢复所有阅读页或页码。
- 通过主内容区菜单“关闭面板”关闭 PDF，检查仅指向合成原文件的进程句柄：从 1 降为 0。顶端 X 的既有语义是“收起面板、保留页面”，不应与关闭菜单混淆。
- 原 PDF SHA-256 前后均为 `b67b3ff968a3b7719e8c0d1055aaf4af94ae3ed503052f533b5e486503cf043a`，667 字节，mtime 秒值仍为 `1790947047`。没有复制 PDF 入库；批注保存在已有 `.liteasy/paper-artifacts` 存储中。EPUB 合成输入 SHA-256 为 `bfd5dc0b01194f90a7810a3bbf366d89abfee2410f9318d22473d37dff79a237`。

原生操作证据在 `/tmp/liteasy-client-native-cold-pdf.png`、`/tmp/liteasy-client-native-hot-epub.png`、`/tmp/liteasy-client-native-reopened-highlight.png`、`/tmp/liteasy-client-native-cold-fixed.png`、`/tmp/liteasy-client-native-main-closed.png` 和 `/tmp/liteasy-client-native-handle-evidence.json`。临时文件不随 Git 分发，也不是 Windows/macOS 证据。

## 集成时修复的反例

初次全量测试发现 ReaderPane 仍断言旧首页标题，改为当前欢迎页标题并验证原文件入口。没有删除用户行为断言或跳过用例。

真窗口复用 profile 冷启动还暴露了测试替身未覆盖的时序：原生 drain/read 已成功，原文件对象仍在，但旧 render 的可用文献集合为空；延后的页面清理 updater 使用这个旧集合，把刚刚添加的 PDF 标签和激活项删掉。修复后清理只移除该 render 已观察为缺失的 ID，激活项清理也检查是否仍为原值，不再删除随后打开的新页面。修复后真实冷启动与已有高亮恢复通过。补充了预排队文件/StrictMode 回归，以及通过公开 Profiler commit 回调控制资料恢复与哈希完成顺序的回归：只恢复旧清理逻辑时后者失败，最终 4 个原文件集成用例全部通过。没有替换 React 内部实现。诊断用临时 DOM 日志已全部移除。

## 分层验证

命令、退出码、日志和具体结果以 [机器报告](first-wave-integration-verification.json) 为准。

- 完整桌面测试：3254 通过、4 个既有跳过。随后发现并修复上述原生时序问题；最终代码另跑受影响 AppShell/ReaderPane/原文件回归，而非把此前的全量结果冒充最终修复后的完整重跑。
- 首页 Playwright：3 通过；这是 Chromium 的交互回归，不是原生文件选择器验证。
- smoke、production build、Cargo locked check、原文件真实文件系统 Rust 测试、workflow lint 和 CI 脚本回归分别记录。生成 schema/锁文件门禁在干净提交 `2ab0efc0` 上通过，输出 `Selected paths match Git; no generated-file or lockfile drift detected.`。核心接线提交为 `781d980d`，冷启动回归提交为 `2ab0efc0`。

## 未验收和后续边界

Windows 原生打开/文件身份检查、Apple Silicon macOS 系统 URL 打开、真实平台安装升级、签名与公证均未执行。Linux/macOS 候选 CI 已接入但没有远端运行或发布。系统选择器自动操作仍待各平台验收；已执行的原生测试通过 argv / 热启动转交触发。

完整 WebView 重新加载会丢失当前临时阅读页，已 drain 的请求不会自动重放；关闭应用后通过选择器或系统打开重新授权。PDF 页码自动恢复、全资料备份恢复、原生 WebdriverIO 桥、完整性能预算和任务包第二轮仍待实施。WSLg 缺少硬件加速，资源数据不能作为正式性能达标结论。

本轮无 schema/数据迁移、无依赖或应用版本升级、无服务端与生产配置修改。撤销本轮代码不删除原文或已有批注；C02 的损坏/未来版本快照保持只读并保留原始字节。集成分支保留原主工作区的用户修改，按任务包约束不自动 push main 或发布安装包。

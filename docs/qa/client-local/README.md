# 客户端任务包：第一轮实施记录

任务来源：`tmp/liteasy-client-codex-2026-10-02`，代码基线 `ff9ea211`，应用版本仍为 0.1.32。

本轮按总控指令先做 C00，再交付 C02/C03/C10 独立切片，并尽早接入 C11；实测发现的 watcher 反馈循环另以 C08 切片修复。**这不是 C00–C14 整包完成或三平台正式发布证明。** 没有自动合入或推送 main，没有发布安装包，未改服务、部署、云同步、账户基础设施和生产地址。原 main 的 `.gitignore` 与未跟踪文档保留。

集成分支：`feat/client-first-wave-integration`，当前工作区 `/home/tjm/proj/Liteasy-client-c03`。最终验收见 [集成记录](first-wave-integration.md) 与 [机器报告](first-wave-integration-verification.json)。每片保留独立分支/提交，集成分支包含全部已交付代码，后续工作从这里继续。不要只取最后一条提交；它依赖前面的本地开发、恢复和原生接口。

| 卡片 | 本轮实际交付 | 验证与剩余边界 |
| --- | --- | --- |
| C00 | 独立临时资料目录、无云 Tauri + Vite HMR、诊断命令、退出清理 | WSLg 真壳/真实文件 IPC/HMR 已执行；[记录](C00-local-development.md) |
| C02 | 损坏/未来版本 Agent 快照保留原文并只读恢复、修订冲突、保存失败阻止后续操作、原子写 | 故障反例与真实临时文件测试；全资料备份/恢复和所有草稿仍待做；[记录](C02-recovery.md) |
| C03 | 首页原文件/文件夹入口、阅读/研究/处理及恢复布局；PDF/EPUB 不复制打开、Markdown 原位置编辑链路 | 前端授权/生命周期/关闭竞态回归；PDF 自动恢复页码和重启后自动授权未实现；[首页](C03-start.md)、[原文件](C03-original-files.md) |
| C08 | 文件读取事件不再驱动重复扫描，自身暂存文件忽略、真实写入/删除/重命名仍刷新 | 真壳新增/重命名/删除已执行；WSLg 软件渲染 CPU/RSS 仍高，完整性能预算未达标；[记录](C08-watcher.md) |
| C10 | 单文件只读授权、冷/热/系统 URL 转交、账户隔离、文件替换检测、Linux/macOS 平台合并配置 | WSLg 集成记录另列；Windows 文件身份分支与 macOS 原生未实测；[配置](C10-platform-config.md)、[原生接口](../../agent-dev/2026-10-02-client-c10-native-open.md) |
| C11 | 保留现有 Windows 分层 CI，增加手动 Linux deb/macOS app+dmg 候选构建、校验和与独立状态报告 | actionlint/脚本回归通过；远端构建未运行，原生自动化桥/安装升级/签名公证仍待验收；[记录](C11-platform-candidates.md) |

## 运行与授权语义

在集成工作区的 `products/liteasy/apps/desktop` 执行 `npm ci`、`npm run client:doctor`、`npm run dev:local`。可用 `npm run dev:local -- --profile <空目录或已有测试目录>` 复用测试资料；切换工作区时使用新测试目录，避免 WebView 缓存旧的绝对模块路径。不会启动 dev-cloud。测试资料保留在日志输出的位置，退出不删除。

- Ctrl/Command + O：原位置打开 PDF/EPUB，只读原文件。关闭页面释放句柄；重启后通过选择器或系统打开明确重新授权。
- Ctrl/Command + Alt/Option + O：打开 Markdown 原文件；编辑保存复用既有修订检查。
- Ctrl/Command + Shift + O：连接笔记文件夹，保留层级。
- 文献库导入仍是复制导入。PDF 批注写入 Liteasy 的既有批注存储，不回写 PDF 原文件。
- 布局预设只修改显示状态；恢复自定义布局目前是本窗口内的快照，不是持久化布局历史。

所有真实窗口证据来自 Ubuntu 24.04 x64 **WSL2/WSLg**，不能替代 Windows 或物理 Linux 验收。Node 22.13.1/Rust 1.98.0 与仓库要求 22.23.2/1.98.1 的差异已记录。临时截图和日志位于 `/tmp`，不随提交分发；机器报告列出实际状态与命令。没有调用付费模型、读取私人文献或导出凭据。

## 后续最小边界

先在原生 Windows 和 Apple Silicon macOS 验证相同合成资料的打开、批注、重启、路径与关闭行为，并执行候选构建；单独验收 WebdriverIO 测试桥的版本与正式包隔离。补齐 C02 全资料恢复、C03 页码/近期原文件恢复后，再按包内第二轮推进 C01/C04/C05 资料与证据、C06/C07 受控处理、C09 可用性、C12 可迁移和 C13 用户任务验收。C14 只汇总已启用的范围，未执行项不能算通过。

# C00：隔离的本地桌面开发

基线 `ff9ea211`，应用版本维持 0.1.32。实现分支 `feat/client-c00-local-development`，独立 worktree；原 main 的 `.gitignore` 和未跟踪评估文档保持不变。此记录不代表 Windows/macOS 验收或安装包可交付。

## 使用

在 `products/liteasy/apps/desktop`，使用 `.nvmrc` 和 Windows workflow 指定的工具链，先 `npm ci`，再运行：

```text
npm run client:doctor
npm run dev:local
```

doctor 输出依赖可用性、版本差异和可行动原因，不安装工具、不读取密钥。`dev:local` 只启动 Vite 和真实 Tauri，不启动 dev-cloud，不读取仓库 `.env.local`。React 文案和样式支持 HMR；Rust 修改仍需重编译。原 `dev` / `tauri dev` 云联调与生产地址保持不变。

启动日志给出独立资料目录。默认自动创建临时目录；重启复用时使用 `npm run dev:local -- --profile "绝对路径"`。只能使用空目录或已带本功能标记的目录，不能指向正式资料目录。`--prepare` 只生成配置和合成 Markdown、HTML、TXT、Canvas、EPUB。可把仓库 `development/test-data/pdf-selection/glyph-boundaries.pdf` 复制到该资料目录的 `data/local-library/library`，然后双击阅读。

资料目录退出后保留，便于恢复实验；确认不再需要后由开发者自行移除。独立应用 identifier 隔离 WebView 的 localStorage/缓存；这些缓存仍位于操作系统应用缓存目录，不保证都包含在临时根目录。删除 profile 前可记录其 identifier，以便清理对应缓存。开发环境阻止网络/凭据 IPC、远程 fetch 与远程页面资源，并且不启动现有 Agent 本地监听器；这不是生产端权限策略。离线推荐可能提示网络被禁止，属于本配置的明确限制。不要把真实资料或密钥导入测试 profile。

## 基线与最小后续任务

| 能力 | 状态 | 当前依据 / 缺口 |
| --- | --- | --- |
| PDF / Markdown / EPUB / Canvas 本地阅读 | existing；本轮仅 PDF 原生实测 | 复用 ReaderPane、外部笔记、电子书、白板现有实现；其余格式待逐项原生验收 |
| 本地资源、路径、对象存储 | existing | 复用 data_location、local_library、objects，未新建数据库 |
| 命令面板、自由 Dock、快捷操作 | existing | workbenchCommands 与 Dock；C03 扩现有入口 |
| 无云原生开发与隔离资料 | existing（本卡新增） | 真实 GTK/WebKitGTK IPC 打开合成 PDF；HMR 生效 |
| 草稿/任务快照恢复 | partial | 已有 agentStatePersistence 与中断任务恢复；坏记录、未知版本后续写入需 C02 反例回归 |
| 搜索与来源追踪 | partial | 已有阅读检索、resourcePathSearch、批注与资源引用；不等同全库全文索引验收 |
| 文件监听性能 | partial | 原生运行静置时重复全库校验日志；应单独复现并消除自身写入引起的监听循环 |
| 原生文件关联 / 跨平台运行 | unverified | 已有 Tauri / 单实例；冷、热启动参数转交与三平台验证待 C10/C11 |
| 三平台 doctor | existing；仅 Linux 依赖实测 | Windows/Mac 探针有测试替身，真实机器 not_run |
| 安装、升级、签名、公证 | unverified | 本卡没有请求构建或发布 |

## 本轮原生实验

Ubuntu 24.04 x64 / WSL2 / WSLg，WebKitGTK 2.52.6，GTK 3.24.41。这是 Linux WebView 的真实原生运行，但不是物理 Linux 主机、Windows 或 macOS 验收。Node 22.13.1 与要求的 22.23.2、Rust 1.98.0 与要求的 1.98.1 有补丁版本差异，doctor 标 degraded；没有自动升级。Secret Service 不可用，未读取凭据，不妨碍离线阅读。

1. 无账号、无 API key，不启动 dev-cloud，通过本地 profile 启动真实 Tauri。
2. 只用合成 `glyph-boundaries.pdf`，库监听后双击，看到一页 `WiWi tail / alpha beta gamma`。读取走真实 Tauri IPC，未模拟文件返回。原件与副本 SHA-256 都为 `b67b3ff968a3b7719e8c0d1055aaf4af94ae3ed503052f533b5e486503cf043a`。
3. 临时将 ReaderPane 按钮文案改为“本地 HMR 验证”，原生窗口实时显示，Rust 进程 PID 85963 未变化；探针文案随后恢复，未提交。
4. 对本启动器发送 SIGTERM，Tauri、Vite 与包装进程全部退出，1420 端口无残留。Windows taskkill 路径仅代码/替身覆盖，未实机验证。
5. 发现原启动器仅终止直接子进程会遗留 Vite/Tauri，本卡已修复进程树退出；发现库监听重复全量校验，单列后续切片，不据此宣称性能验收通过。

日志与截图为本机 `/tmp/liteasy-c00-*` 临时证据，不随源码提交，不是长期 CI artifact。机器可读结果见同目录 `C00-verification.json`。禁外部网络依据是开发配置/IPC/fetch 回归与现场离线阅读；未做全进程抓包，不能称所有未来新增命令都已隔离。

## 数据兼容与回退

无 schema、锁文件、应用版本或生产地址改变；开发 profile 仅 debug 构建显式开启，正式 Release 忽略该环境变量。原正式数据路径不迁移。回退为停止 `dev:local` 后恢复使用现有开发入口，临时测试资料仍保留。C02 下一片优先保证坏快照不会被空状态覆盖。

# C07：复用本地授权的只读 headless 入口

2026-10-03；实现 `2973ffb6`；状态：接受此有限切片，C07 整卡和三平台安装包验收未完成。

原有 `--agent-cli` 通过 Unix socket 和前端事件桥控制运行中的桌面。新增 `--agent-cli local-files` 在创建 Tauri、WebView、窗口或 agent host 前执行；确定性读取直接复用 `note_files::store::FileStore`。既有 agent 命令和其传输保持兼容。main 由集成分支接入 `headless_cli::run_external_mode(data_location::headless_root, desktop_identity::local_object_scope)`。

命令始终输出 `liteasy.local-files-cli/v1` JSON；`--json` 可显式声明同一格式。以下 `$GRANT` 必须来自当前本地作用域已有的桌面选择器授权，不接受绝对路径作为 grant：

```bash
liteasy-desktop --agent-cli local-files mounts --json
liteasy-desktop --agent-cli local-files list "$GRANT" --json
liteasy-desktop --agent-cli local-files extract "$GRANT" '研究.md' --json
liteasy-desktop --agent-cli local-files extract "$GRANT" '研究.md' --expected-revision "$SHA256" --json
```

`extract` 返回未转换的 UTF-8 Markdown/Canvas 源文、GUI 同一 Snapshot（含 version）、`revision`、`format`、`bytes` 和 `truncated:false`。它不是 PDF/EPUB 文本解析器。单文件限制沿用 8 MiB，目录清单沿用 10000 项/64 层边界；超过边界报错，不返回静默截断结果。内容 revision 是所返回字节的 SHA-256；不加 expected revision 时读取当前内容。读取过程中修改原文件的严格快照隔离尚未实现。

成功仅写 stdout；结构化失败仅写 stderr，不回显未知参数值或文件内容。退出码为：0 成功，2 参数/路径格式错误，3 数据根或授权库不可用，4 非本地作用域/授权不存在，5 revision 冲突，6 读取失败，7 stdout 写入失败。无交互授权、写命令、凭据参数、`--scope`、任意 `--output`、resume 或模型调用。Ctrl+C/管道关闭不会留下文件任务或执行回执；只读查询没有提交意图，不新增状态库/journal。中断中的 stdout 可能是不完整 JSON，调用方必须同时检查退出码与完整 JSON。

有效 native scope 必须恰好为 `local`；此检查早于数据根解析。恢复 profile 的 `user:*` 固定作用域不能因未恢复 OAuth 而变成 local。启动过程不读系统凭据。调试 profile 只走现有、带标记校验的 `local_dev::profile_root()/data`；release 不启用开发环境变量。普通运行使用与 Tauri 一致的用户数据位置及应用 identifier：Linux 绝对 XDG_DATA_HOME 或 HOME/.local/share、macOS HOME/Library/Application Support、Windows APPDATA。共享 data-location 配置决定自定义根；Windows 保留安装目录/LiteasyData 的既有选择规则。缺失目录、待迁移设置、失效授权库都拒绝，不创建空库、不执行迁移、不转向其他根。

FileStore 使用 SQLite read-only connection/query_only 和原授权表，同时显式阻止文件写入、目录创建、授权注册、同步导入及 C06 回执变更。测试证明并存 GUI 连接提交的新授权可见，关闭后数据库主文件字节保持一致。SQLite WAL 读取可能创建/使用 `-wal`/`-shm` 协调文件；这里的“只读”指不改资料内容、授权记录和任务状态，不承诺数据库目录零文件系统活动。不会用 immutable 模式隐藏活跃 GUI 的 WAL 更新。[SQLite WAL 官方说明](https://www.sqlite.org/wal.html#read_only_databases)

复用的路径检查拒绝符号链接、Windows reparse point、设备/管道、路径穿越、绝对路径、未知格式与非 UTF-8。检查到实际打开之间的可移植路径 TOCTOU 限制仍存在；不宣称能抵抗同一 OS 用户恶意并发替换整个目录树。数据根迁移后的 managed grant 仍须先由 GUI 的既有迁移流程更新，CLI 不修改授权位置。

本切片不引入 Node sidecar：已存在的 Rust FileStore 足以完成确定性读取，不需要搬迁 TypeScript AI 编排。Cargo/npm 依赖与锁文件没有变化；没有测量安装包或二进制体积差，因此不声称“零体积成本”。如果 AI headless 后续选用 sidecar，需按每个目标平台打包可执行文件、固定宿主/协议版本并测量下载和安装体积；本轮未实施或验证 Node sidecar。[Tauri external binaries 官方说明](https://v2.tauri.app/develop/sidecar/)

当前源码的 Windows release 使用 `windows_subsystem="windows"`；该子系统没有自动附加控制台，终端 stdout/退出等待、重定向以及独立 console launcher 的打包仍待 Windows 实测。未将 Linux 单元测试写成 Windows CLI 通过；macOS 启动与打包也未执行。[Rust Windows subsystem 官方说明](https://doc.rust-lang.org/reference/runtime.html#the-windows_subsystem-attribute)

尚未完成的 C07 项目：Windows 同用户受限命名管道，Unix peer/帧/并发/断连完整检查，GUI/CLI 并发写租约与回执，三平台无源码/无全局 Node 安装验证，AI sidecar 三平台可行性和体积测量。只读文件命令不经 IPC，不能算旧桌面控制协议的修复。

# C02：隔离配置恢复与 Canvas 迁移修复

这是接在所选资料交换归档之后的私有恢复副本；不把 C12 的去标识交换包当作完整用户数据库。私有恢复保留当前分区和不可变对象 ID/版本，不包含系统凭据或原外部目录授权。C02 全卡仍未完成。

## 真实行为

`local_recovery` 对当前作用域的 `object_records` 使用 SQLite 只读事务导出逻辑记录，不复制活动 DB/WAL 文件。笔记正文、历史版本、关联、白板布局、附件描述、Agent 快照、操作/运行回执保留已有 key/version/value。凭据/设置、插件安装/配置/授权/触发器不入选；选中记录若包含已知凭据字段则停止并说明原因。损坏 JSON 原始字节保留用于诊断，未知可解析对象 schema 在恢复时拒绝，不用空值替换。

文献库完整树复制到恢复配置的 `data/local-library/library`，保留库 ID、索引及按 document ID 存储的 `.liteasy/paper-artifacts` 批注/锚点。当前分区的 `objects/assets/<sha256(scope)>`、`boards/<sha256(scope)>`、`synced-boards/<sha256(scope)>` 带指纹复制。已有 `object-file/`、`board-file/`、`object-attachment/` 关联只解析已授权的文件；外部笔记实际内容复制到新配置的 `restored-files/<scopeHash>/<mountId>`，恢复的新 grant 只能访问这个拥有的副本，不记录旧外部绝对路径。

备份和恢复均先预览，确认后创建全新目录。恢复从逻辑快照建立现有 `object_records`/`grants` SQLite schema，保留分区、不可变 ID、revision 和 row version。因此原对象、关联与笔记绑定能继续使用既有工作台。旧库和源文件不覆盖。预览后对象记录变化、文件变动、坏指纹、未知版本、路径穿越、链接/联接、大小超限均失败；开始写后失败保留未完成标记，不能当完整配置启动。多文件操作不宣称原子事务。

`profile.json` 只在资料/数据库建立成功后写入，`recovery-receipt.json` 绑定 profile 和 manifest 指纹。bootstrap validator 检查普通绝对目录、未完成标记、精确版本/分区、回执指纹和 SQLite quick_check。用户明确点击“打开隔离恢复配置”后，命令仅启动回执标识对应的已校验配置，不接受任意 renderer 路径。

## 根代理集成契约

在 main 声明 `mod local_recovery;` 并注册：

```rust
local_recovery::local_recovery_prepare_backup,
local_recovery::local_recovery_prepare_restore,
local_recovery::local_recovery_commit,
local_recovery::local_recovery_cancel,
local_recovery::local_recovery_open_profile,
```

在资料备份设置组合 `<ProfileRecoveryPanel scopeId={objectWorkbench.repository.scopeId} />`，导入来自 `../features/local-recovery/ProfileRecoveryPanel`。

启动参数为 `--recovery-profile <absolute-folder>`，须在单实例插件、OAuth、数据目录和后台任务初始化前处理。命令去掉继承的 `LITEASY_LOCAL_DEV_PROFILE`。调用：

```rust
let bootstrap = local_recovery::validate_profile(path)?;
// bootstrap.profile_root: PathBuf — 新配置目录
// bootstrap.active_root: PathBuf — 新配置目录/data
// bootstrap.archived_scope: String — 原分区 "local" 或 "user:..."
```

marker 精确为 `{schema:"liteasy.recovery-profile/v1",id:<32 hex>,scope:<archivedScope>,root:"data",localOnly:true}`。本地 bootstrap 复用现有 profile_root 路径分流；WebView 用 `<profile_root>/webview`；必须关闭主实例转发、Agent host、OAuth/凭据恢复和联网命令。IPC `local_object_scope` 返回 archived_scope，而不是签入账号。前端运行时 bootstrap 应在创建对象仓库前提供 `{scopeId, localOnly:true, recovery:true}`；不得制造 OAuth 会话。`localAccountKey` 为 archivedScope 为 local 时 guest，否则原 user:*；文献库本身已是设备库，不按账号重建，批注 sidecar 保留 document ID。

此模块不编辑 main/local_dev/desktop_identity/AppShell；启动和组合验证由根代理完成。未完成这些端口前，“打开隔离恢复配置”不能算已验收。

## Canvas 迁移缺口

提交 `631d3781` 修复 `data_location::MANAGED` 遗漏 boards/synced-boards，并在 FileStore 打开时将这两个当前分区拥有目录的 grant 指向经批准的新数据根目录。外部授权仍指向原选择。旧预览依赖的绝对位置改变后需重新预览，不能默默把外部授权扩展到新位置。

真实反例先失败：迁移后 Canvas 目标文件不存在。修复后 6 个 data_location 测试和 1 个 FileStore 真实重开测试通过，测试保留源数据、检查外部 grant 不变。Rust all-target locked check 通过。

## 本片验证与限制

Ubuntu 24.04 x64 / WSL2，Node 22.13.1 / Rust 1.98.0，分别低于项目当前指定的 22.23.2 / 1.98.1。

- `cargo test --locked --no-default-features --manifest-path products/liteasy/apps/desktop/src-tauri/Cargo.toml --test local_recovery`：5 例通过，使用真实临时文件系统与 SQLite，源 WAL 连接保持打开；重新连接恢复的对象和 grants DB 并读取完整笔记、revision、关联、任务回执、批注侧文件、Canvas 和外部笔记副本。其他账户和凭据未进入快照。另覆盖变更、未知版本、损坏原始行、注入中断、路径/链接/大小上限、profile scope 篡改和拒绝覆盖。
- `npm test -- --run src/tests/ProfileRecoveryPanel.test.tsx`：2 例通过，原生 IPC/选择器使用替身，覆盖预览→确认→回执→独立打开和账户变化清理。
- `npm run ci:smoke`：9 例通过；`npm run build`：通过，现有 chunk 提示保留。干净提交 contracts 结果另记。

原生包装层/启动 UI 尚需根代理集成后检查。本片尚未执行真实窗口从新配置重启、原生选择器自动化、Windows/macOS、磁盘满/只读或杀进程。

有边界的恢复内容：只覆盖当前分区及当前文献库，未入库且只在临时原位置阅读器中打开的原文不自动获得新访问权；浏览器偏好/页面布局缓存不备份。外部关联附件若是目录而非文件会明确停止；不会默默把整个 Vault 或私人目录打包。当前非对象型独立 artifact catalog/checkpoint 目录未纳入；插件配置/可执行代码不自动恢复。无任务重放或自动发布承诺。库文件中用户自行写入的秘密不做语义识别。

恢复目录含私有正文、原对象 ID、原作用域，应按私人备份保存；跨工具交换使用 C12 的去标识资料归档。回退不改原数据 schema；旧程序不能直接选择此 profile 标记，但保留 manifest/snapshot/原文供新版本继续校验恢复。

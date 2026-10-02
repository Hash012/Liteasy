# C12 / C02：所选资料归档与新目录恢复

此片提供真实本地目录往返，不代表 C02 完整用户配置恢复或 C12 全卡完成。基于 `0fba97be`，未修改服务、远端同步、依赖锁或共享 schema。

## 使用与数据边界

在“所选资料归档与恢复”选择带本地原文的文献，选择保存父目录，查看原文/笔记/关联数与文件清单，再确认。预览不创建输出。系统创建新的 `Liteasy-Archive-*` 子目录，不覆盖已有目录。恢复入口选择该归档及新的保存父目录，校验全部指纹、容量、版本与路径后，再明确确认写入 `Liteasy-Restored-*`。

恢复回执中的“打开原文”重新校验该文件并交给现有原位置阅读器；“阅读笔记”和“阅读批注文字”显示完整文本，不执行其中 HTML。也可用文件管理器打开源 PDF/EPUB，或通过现有“打开 Markdown”编辑归档笔记。相对来源链接和页码/摘录提供应用外兜底。

- `manifest.json` 是 `liteasy-local-archive` v1：归档内文献/笔记 ID、相对路径、SHA-256、字节数和来源关系。拒绝未知版本/字段、缺少映射、路径穿越、Windows 保留名称、大小写碰撞、链接/联接和特殊文件。单文件最多 256 MiB，元数据/笔记最多 8 MiB，总计最多 1 GiB / 4096 文件 / 256 原文。
- `sources/` 保留所选 PDF/EPUB 原始字节。`annotations/` 保留批注文字、页码、几何、绘图、支持的内嵌图片、评审和速问正文。嵌套结构按字段投影；账号、发布/同步状态、原私密 ID 不携带。AI 讲解保留类型，不携带私密运行 ID。
- `notes/` 保留所选资料关联的活动笔记完整正文和批注文本，不只标题/摘要。多个页码锚点分别保留。具有独立附件的对象笔记暂不支持，明确失败而不默默丢附件。未关联到所选文献的笔记不在此导出范围。
- `receipts/` 仅保留关联工作流的状态/时间摘要，使用归档内 ID；不能从这些摘要继续执行旧任务。不会复制活动 SQLite/WAL、账号设置、凭据、授权或私人会话。原文本身和用户手写正文保持内容，不声称能识别其中用户自行粘贴的秘密。
- 预览绑定源指纹、批注存在性/指纹、对象记录版本和当前文献库位置。原文、批注、笔记或 manifest 在预览后改变时需重新预览。计划仅当前账户可提交、10 分钟到期、最多 4 项，账户变化使旧异步响应失效。
- 写入用新目录和逐文件 `create_new`；检查当前账户贯穿复制。失败保留 `.liteasy-archive-incomplete.json` 和已写副本，原资料不变；该目录不被视为可恢复完整归档。完成 manifest/回执最后写入，不把多文件写入称为原子事务。

## 集成端口（根代理负责）

`src-tauri/src/main.rs` 增加 `mod local_archive;`，在既有 `generate_handler!` 注册：

```rust
local_archive::local_archive_catalog,
local_archive::local_archive_prepare_export,
local_archive::local_archive_prepare_restore,
local_archive::local_archive_commit,
local_archive::local_archive_cancel,
local_archive::local_archive_open_restored,
local_archive::local_archive_reveal,
local_archive::local_archive_read_note,
```

本地开发 IPC 白名单需明确允许这 8 个纯本地命令。生产配置不变。界面在现有资料/备份设置区组合：

```tsx
import { LocalArchivePanel } from "../features/local-archive/LocalArchivePanel";
<LocalArchivePanel scopeId={objectWorkbench.repository.scopeId} />
```

feature 只依赖现有共享客户端/类型，不导入 layout。命令参数只收作用域、文献 ID、计划/回执 ID；文件路径由原生选择器或当前库快照解析。选择器/哈希/复制用异步或 blocking worker。原文打开复用 `native_open` 精确授权队列，没有第二套任意路径读取命令。

模块尚未注册时，`src-tauri/tests/local_archive.rs` 通过 `#[path]` 直接编译核心文件并测试真实临时文件系统；这不证明 Tauri 包装层已编译。集成后必须运行实际宿主 `cargo check --locked --all-targets --no-default-features`，以及真实原生文件选择/恢复回执路径。

## 已执行验证

Ubuntu 24.04 x64 / WSL2；Node 22.13.1（仓库要求 22.23.2）、Rust 1.98.0（workflow 要求 1.98.1）。没有真实 Windows/macOS 测试。先添加测试后实现；初始 Rust 和前端因缺少实现失败，随后通过。

- `cargo test --locked --no-default-features --manifest-path products/liteasy/apps/desktop/src-tauri/Cargo.toml --test local_archive`：7 例通过；真实临时目录，含 Unicode 原文、完整文本/几何往返、凭据字段排除、未知版本/坏 hash、预览后变化、已有目录、恶意路径/碰撞、符号链接、写入中断后诊断标记。中断由 guard 注入，不是真实杀进程/磁盘满。
- `npm test -- --run src/tests/LocalArchivePanel.test.tsx src/tests/localArchiveService.test.ts`：5 例通过；IPC/选择器为替身，验证显式确认、正确计划/回执参数、字面 HTML、错误无成功回执、账户切换取消旧预览。
- `npm run ci:smoke`：9 例通过。`npm run build`：通过，现有 chunk/dynamic import 提示仍在。
- 干净提交上的 `npm run ci:contracts` 结果单独记录在验证 JSON；根代理集成后需要复查宿主与最终组合。

## 兼容、回退与剩余工作

此片不改变现有库/对象 schema；移除功能后归档的 PDF、EPUB、Markdown、JSON 仍可读取。失败时保留新副本和源目录，不删除旧库。恢复不切换当前库，也不自动把归档几何批注重新注入现有批注存储。

尚需：全用户文件/对象/附件/任务回执的一致备份与恢复到空本地配置；将恢复的对象笔记和几何批注接回可编辑工作台；外部编辑显式合并预览；Connector 旧档案映射；Mobile 交换兼容；跨 OS 原生选择/重新定位；真实只读/磁盘满/杀进程。当前选中资料往返不能标成完整灾难恢复已通过。

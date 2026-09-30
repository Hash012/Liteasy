# Liteasy 本地扩展与方法制作

此文对应桌面 0.1.25 的声明式实现。设计背景见 [平台规格](../superpowers/specs/2026-09-29-liteasy-extension-platform-and-workflow-studio-spec.md)。本地使用不要求云端登录，模型调用使用已有连接。

## 从可运行样例开始

1. 在活动栏打开 **扩展**，添加论文比较板并启用；或打开 **制作扩展 → 从论文比较模板开始** 创建个人草稿。
2. 草稿包含类型、组合、页面、设置、流程、skill 和三个真实执行的 fixture。编辑后保存，使用“校验与预览”检查主题和窄栏。
3. “隔离样例试跑”使用当前账号存储下的临时命名空间、样例资料及明确的 mock 模型输出，不读取真实论文或调用配置的模型。结果与草稿摘要绑定；修改后必须重新试跑。
4. 发布生成不可变版本与 `extension.lock.json`，然后在扩展页启用。导出/导入使用相同 JSON 包。
5. 打开比较台，新建可拖动的四列白板；或运行比较流程，选择资料与模型。运行会保存笔记和白板，校验输出字段、引用及实际可读取的证据覆盖。

白板字体、行距、锁定和层级独立于内容保存。AI 修改结构化内容会推进可见卡片引用，保留位置、大小和样式。布局可以撤销/重做、对齐、分布、分组；遮挡的卡片可从图层列表选中。导出白板与附件会生成 ZIP，解压后保留 `board.canvas` 和 `attachments/` 的相对位置；README 列出未能打包的引用。外部修改了 Canvas 文本时，不用旧组件元数据覆盖它。

## 包与数据契约

- 清单：`liteasy.extension/v2`。包：`liteasy.extension-package/v1`，文件路径、大小、大小写冲突和 SHA-256 摘要均由宿主检查。
- 基类：RichTextBlock、MediaBlock、ResourceBlock、CollectionBlock、GroupBlock。派生字段只能扩展，不能移除基础能力或覆盖公共字段。
- 结构化内容：`liteasy.visual-block/v1`，使用 `<owner>/<type>@<version>` 标识类型；正文仍保存为可读的核心笔记资源。类型数据、内容 revision 与 presentation 分开存储，未安装 renderer 时可按普通内容读取。此方案不放宽核心 object v1 严格联合类型。
- 配置：按 global/profile/workspace 分层，CAS 保存；每次替换保留旧版本备份。未知格式保持只读，可导出；兼容迁移必须先预览将丢弃的字段，然后显式应用。
- 依赖：清单 `dependencies` 中记录 `id/version/digest/path`；`path` 是包内嵌套的依赖包 JSON。验证精确版本与实际摘要，最多四层。依赖提供的类型不会自行激活页面或扩大调用者权限。
- 算子：`contributes.operators` 指向包内的确定版本工作流；调用 ID 是 `<owner>/<localId>`，入参为一个 `value` 对象。编译时展开并固定为原始节点。声明式算子及 `core.subflow` 不能绕过能力闭包、节点总数和预算。

可执行 schema 位于 `products/liteasy/packages/shared/`，由桌面的 `schema:resources` 生成：extension.v2、compiledWorkflow.v2、blockPresentation.v1、visualBlock.v1、skill.v2。只有目录实际列出的 API 可调用；规格中的拟议名字不等于已注册操作。

## Agent、MCP 与 SDK

现有本机 MCP 的读写开关继续生效。AI 可用以下工具完成制作：

- `liteasy_extension_catalog`：默认摘要；指定 kind/id 才加载一个完整契约。
- `liteasy_extension_create/draft/drafts/patch/validate/trial/export`：创建、版本化修改、检查、试跑和导出草稿。AI 不得修改已有 fixture 条件。
- `liteasy_block_create/read/update`：真实的类型化资产读写；更新要求 expectedRevision 和 operationId。
- `liteasy_board_template`、`liteasy_extension_from_run`：将明确选中的白板或成功运行提炼成新草稿，不复制整段聊天和运行正文快照。
- `liteasy_skills`：先列摘要，再读取一个 skill；说明文本不授予权限。
- `liteasy_workflow_request`：将已选资料送入真实工作台的参数/授权窗口；返回等待用户开始，不冒充已执行。
- `liteasy_workflow_runs/inspect/control/replay/recompute`：查询记录、暂停/恢复/取消、无副作用回放、纯节点固定条件重算。恢复沿用已绑定版本与授权，取消信号传到同一执行器。
- `liteasy_extension_compatibility`：使用原验证器检查 v1 扩展或方法；原生 v1 handler 仍要求旧 transport，不被伪装为可执行 v2 代码。

`packages/extension-sdk/src/index.ts` 提供无 React 的 transport 客户端。宿主附加实际账号、授权和身份；外部客户端不能填写一个 scope/path 获得权限。启用和安装仍由本机用户操作。普通聊天不枚举插件正文、全部文库或所有 API schema。

## 执行与恢复

扩展内 Markdown 编辑器会按账号及 Liteasy Path 保存未提交草稿；外部修改导致冲突时保留草稿，不覆盖原文。磁盘配额不足会显示提示，保留当前会话副本供保存或复制。

工作流编译检查图、端口、引用、能力与版本。运行保存定义、配置、输入、节点快照和持久操作回执。读取和写入调用已有资源 service；创建使用稳定 operationId，外部写入结果不确定时暂停核对，不自动再写。记录回放不会调用网络/模型或重新写文件；重新调用模型产生新 run。

运行页支持暂停、继续、单步、断点、人工补充、条件撤销与正文快照清理。纯节点重算比较固定快照的输出摘要，不能将模型调用宣称为逐字可复现。

自动触发须先手动成功一次，可选择 App 启动、资料 revision 变化或定时。只在 App 运行时工作；休眠后最多补一次，不追赶无限积压。事件先落盘再执行，按事件与固定版本去重，忽略本次实际写出的 revision，失败暂停自动触发。每插件最多两个操作、全局四个，队列有界且支持取消。

WebDAV 中扩展包、配置、方法草稿、运行记录和正文快照分别可选，默认关闭；资产内容沿用既有同步选项。同步来的包默认停用。执行授权、触发器和目录绑定不跨设备复制，模型凭据仍使用既有可选加密同步。

## 发布边界与验证

声明式组件、嵌套方法、Studio、真实资产写入、记录恢复和本机同步已接入正常启动路径。任意 JavaScript、npm/原生命令和自定义 WebView 代码没有开放；规格要求先完成 Windows 独立进程终止、内存硬限制、DPI/焦点/拖放与崩溃恢复实验，不能以 CSP/iframe 或浏览器单测代替该门槛。

旧 v1 extension/UI/workflow 验证器保持独立；旧线性方法显式编译原有顺序与绑定，仍由其已授权 runtime 执行。新持久运行、断点与重算用于 v2；旧版专有业务算子不会被自动映射为权限更大的新操作。

Windows Installer 是否通过，以现有完整 CI 的 Rust、Release、NSIS、cleanliness 和上传结果为准。Linux 的测试、浏览器截图和构建不构成 Windows WebView2 的内存隔离或响应时间基准。

# 数据保存位置与 Liteasy Path

## 用户入口

- 桌面版设置中的「数据保存位置」允许选择目标父目录，应用创建 `LiteasyData` 子目录。目录更改在重启时应用；用户可以在重启前取消。
- 文献、Notes 条目、产物库和对象详情提供「位置与 Liteasy Path」。本机文件可以在文件管理器中显示；数据库中的内容显示数据库文件位置；云端和浏览器资源如实说明存储方式。
- Agent 输入区提供「通过 Liteasy Path 添加上下文」。也可以把单个完整路径直接粘贴进消息框。读取成功后显示资源名称和固定版本附件；发送时通过公共 Agent API 的 `contextRefs` 传递，随后解析实际正文。

## 保存目录

`src-tauri/src/data_location.rs` 是应用业务数据根目录的唯一入口。启动配置 `data-location.v1.json` 固定留在系统应用数据目录，包含当前根目录、待迁移位置及历史目录别名。

重启时，在对象存储、Agent host 和文献监听器启动前复制业务数据。覆盖对象数据库及附件、文献库与其索引/批注/产物、文件授权记录、聊天历史、Agent 状态、工作流检查点、产物目录及导出记录。外接 Vault、单独配置在数据根目录外的文献库、用户自行导出的文件保持原位置。WebView 配置、浏览器本地存储、系统凭据和可重建缓存不迁移。

复制按块处理文件，并核对 SHA-256 和完整目录清单；目标目录必须不存在，拒绝新旧目录包含、符号链接和 Windows 目录联接。校验成功后发布副本并保存启动指针，原目录不删除。Unix 下副本目录/文件权限分别为 0700/0600。

复制中断时原目录继续有效；副本已发布但指针尚未保存时，只有迁移标记及完整业务数据再次匹配才允许恢复。原目录出现新修改则拒绝启用旧副本，提示取消目录更改并选择新位置。已配置目录缺失时不创建空库。历史路径在文献读取边界映射到当前根目录，同时保留 Windows 普通路径与规范路径别名。

## 内部路径

Liteasy Path 是资源定位符，不授予文件访问权限。当前支持：

| 资源 | 路径形式 |
| --- | --- |
| 笔记、白板、片段、对话对象等 | `liteasy://objects/{id}?scope={scope}&revision={revision}` |
| 文献全文 | `liteasy://papers/{id}?scope={scope}` |
| 已保存生成产物 | `liteasy://agent-artifacts/{id}?scope={scope}` |
| 已授权 Markdown / Canvas | `liteasy://files/{mountId}/{relativePath}?scope={scope}` |
| 论文批注 | `liteasy://paper-annotations/{paperId}/{annotationId}?scope={scope}` |
| 产物批注 | `liteasy://artifact-annotations/{artifactId}/{annotationId}?scope={scope}` |

标识符及路径段经过 URL 编码。对象路径可携带 selector；无 revision 时读取最新版本后固定引用。已有统一资源接口生成的 `liteasy://resources/artifacts/...` 也可读取，校验账号范围和内容摘要版本。

解析器拒绝跨账号路径、目录跳转、不支持的参数及协议。实际读取继续经过当前账号对象仓库、已授权文件服务、文献全文准备流程及当前账号产物客户端；不存在时报告错误。外部文件仅支持已有文件服务允许的 Markdown 和 Canvas，其他格式需先导入成 Liteasy 支持的资源。白板包含其成员的固定引用；加入及发送均沿用已有上下文大小限制。路径不能绕过磁盘授权或读取任意服务器文件。

## 验证

- `liteasyPath.test.ts`：编码、路径边界、账号隔离、对象版本、外部正文及产物摘要。
- `resourceLocation.test.ts`：绑定文件与数据库位置、云端/浏览器语义、失效授权。
- `DataLocationSettings.test.tsx`：待迁移与当前路径分离、取消、迁移错误及浏览器入口。
- `assistantArtifactRouting.test.tsx`：粘贴后公共 Agent 请求携带固定引用；全文准备期间禁止发送；失败不产生附件。
- Rust 测试覆盖真实目录复制、原数据保留、中断恢复、变化检测、权限及符号链接拒绝，并验证无论文来源的笔记产物也能落盘。
- `liteasyPath.browser.spec.ts` 使用真实 Markdown 导入、复制路径和上下文解析，不调用外部模型。

Linux 自动测试不能替代 Windows 安装包中目录选择、重启迁移、Explorer 定位的实机验收。

### 本次验证记录（2026-09-16）

- 功能相关 Vitest：5 个文件、34 项通过。
- Rust：`cargo test --locked` 90 项通过；Windows 路径别名补充后迁移相关 3 项再测通过，`cargo fmt --all -- --check` 通过。
- `npm run build` 通过，包含 TypeScript、schema 生成和 152 个运行资源校验。保留现有大 chunk 提示。
- Chromium：完整 Markdown 导入、位置查看、剪贴板复制、Liteasy Path 上下文附件及真实正文解析，1 项通过。截图由 Playwright 写入忽略提交的 `test-results/`。
- 完整 Vitest 首轮：2520 项通过、4 项跳过、2 项失败。失败为既有 `ArtifactLibraryPane` 重命名弹窗和 `PaperResourceTab` 重译确认弹窗用例；前者单独复测 11/11 通过，后者单 worker 复测 10/10 通过。首轮仍记录为非全绿，不把单独重试描述为整轮通过。

# Liteasy 本机资产 MCP

Liteasy 桌面版提供 `--local-mcp` STDIO 入口。Codex 使用自己的模型直接操作 Liteasy 资产，不通过 Liteasy 内部 Agent 再调用模型。Windows、Linux、macOS 使用同一套桥接代码；本次开发环境验证为 Linux，Windows 原生进程和 Codex 桌面连接还需在 Windows 实机验收。

## Windows 配置

1. 打开 Liteasy → 设置 → AI 与助手 → 本机 MCP · Codex。
2. 启用本机 MCP。需要保存结果时，再打开“允许创建和修改资产”。
3. 点击“复制配置”，合并到 Windows 用户目录的 `.codex/config.toml`。已有 `[mcp_servers.liteasy]` 时替换该段，不要重复声明同名表，也不要覆盖其他设置。
4. 在 Codex 的 MCP 设置中重启连接，或重启 Codex。连接期间保持 Liteasy 打开。

设置页使用当前安装程序的真实路径生成配置；以下仅为格式示例：

```toml
[mcp_servers.liteasy]
command = "D:\\Apps\\Liteasy\\Liteasy.exe"
args = ["--local-mcp", "C:\\Users\\Alice\\AppData\\Roaming\\com.liteasy.desktop\\local-mcp\\connection.json"]
startup_timeout_sec = 15
tool_timeout_sec = 120
```

不要手动猜测 `connection.json` 的位置，使用设置页生成的值。搬动安装目录后需重新复制配置。此配置用于 Windows 本机 Codex；WSL 或远程 Codex 主机不会自动共享 Windows 进程和用户目录。

Codex 的 STDIO、配置文件位置和桌面连接设置参见 [OpenAI 官方 MCP 文档](https://developers.openai.com/codex/mcp)。无需注册公开 MCP、插件、OAuth 应用或开放公网端口。

## 使用示例

> 在 Liteasy 查找 Cicada 和 CicN。按需读取论文及笔记，把论文的并发控制要点追加到 CicN，保留已有内容，最后给我可点击的 Liteasy 链接。

> 读取 Liteasy 里的研究白板，整理节点与连接。先读取当前版本，再保存 JSON Canvas；遇到版本冲突就重新读取，保留我的修改。

> 在 Cicada 论文下面创建“性能分析”笔记，写入我的实验总结，并创建一个关联白板。

## 资产能力

通过现有 `AgentAssetService` / `AgentAssetAdapter` 访问广义资产，不扫描操作系统任意目录，也不直改数据库文件。

| 资产 | 读取 | 修改 |
| --- | --- | --- |
| 论文 PDF | 元信息、可用的解析正文；明确缓存页码/覆盖限制 | 原文件只读；在论文下创建分析笔记、白板 |
| 内部 Markdown 笔记、论文笔记 | 分页正文、版本 | append/replace；不可变历史版本保留 |
| 内部白板 | JSON Canvas 节点与连接 | replace；结构验证、版本校验；修改引用卡片时保留原始来源 |
| 已连接文件夹 / Obsidian Markdown | 分页正文、文件内容版本 | compare-and-swap 写文件；Obsidian 编辑态返回提醒 |
| 已连接 Canvas | JSON Canvas | replace；写入前验证结构，底层文件服务检查版本与路径 |
| EPUB / MOBI / TXT / 导入的 Markdown 等阅读文件 | 已导入的统一来源对象正文，保留节选提示 | 来源只读；可创建独立笔记保存分析 |
| 摘录、原图、图片集、生成产物、对话快照 | 对象文本与支持的图片；旧产物走现有产物适配器 | 来源/快照只读；可创建独立笔记保存分析 |

`stat.capabilities` 是某个具体资产的真实能力。不要把只读来源、二进制文件或固定选区描述为可任意重写。扩展新资产类型时注册适配器即可共享搜索、读取、写入与上下文能力；MCP 不再维护一份独立的资产映射。

| 工具 | 行为 |
| --- | --- |
| `liteasy_search` | 标题 / Liteasy Path 搜索；空查询浏览最多 100 条；大库请缩小关键词。只返回元信息。 |
| `liteasy_stat` | 路径、名称、类型、修订、能力、关联论文。 |
| `liteasy_read` | 默认 12,000、最多 80,000 个 UTF-16 字符，使用 `nextOffset` 翻页。 |
| `liteasy_read_image` | 按索引返回一张已授权的本地图片；沿用现有每资产 12 张 / 5 MiB 图片上限。 |
| `liteasy_write` | 必须提交 `expectedRevision` 和 append/replace；单次输入最多 1,048,576 字符，最终正文仍受 8 MiB 限制。 |
| `liteasy_create` | 创建 note / 空 board；可提供 `paperPath` 挂到论文附件；用同一 `operationId` 和相同参数安全重试创建。 |

覆盖写入前必须读完正文。版本冲突时重新读取、合并后再写，不提供强制覆盖。白板创建后再用 `liteasy_write` 写节点。生成内容里的路径使用 `[标题](liteasy://...)` 链接。

## 本机边界与生命周期

- 默认关闭，每次启动需启用；账号切换后撤销，切回原账号也不会自动启用。只读模式隐藏写入工具，并在调用时再次拦截。
- 对外协议是 STDIO。应用内部使用随机端口的 `127.0.0.1` TCP，逐请求校验随机令牌、账号范围和连接代次；不是 HTTP 服务，不接收浏览器 HTTP 请求。
- 连接凭据留在当前操作系统用户的应用配置目录。Unix 目录/文件权限为 0700/0600；Windows 使用用户应用配置目录继承的 ACL。同一操作系统账号内的程序属于同一个信任边界。
- Codex 配置只含程序路径与连接文件路径，不包含 API 密钥或连接令牌。关闭 MCP / 更改权限 / 切换账号会删除或替换连接文件并使旧连接失效，需重启 Codex 的 MCP 连接。
- 原生入口在 Tauri 初始化和 single-instance 插件之前执行；STDOUT 仅写 JSON-RPC，诊断走 STDERR。
- 帧限制 16 MiB，未认证 socket 读取期限 2 秒，前端请求期限 110 秒；内部逐请求处理，不随连接数量创建无界线程。关闭权限或离开账号时中断未完成请求；已提交的修改不会撤回。
- 因超时、进程关闭而没有收到回执时，先查资产版本和内容再重试写入；创建使用原 `operationId`。不要把传输错误当成确定未写入。
- 原生 MCP 不调用模型；资料是否发送到模型供应商由用户的 Codex 配置决定。应用内仅显示最近工具名、时间和完成状态，不记录读写正文。

## UI 一致性

保存复用真实对象仓库 / 文件服务与变更通知。干净的已打开论文笔记自动刷新；未保存草稿不被外部写入覆盖，再保存时通过修订检查提示冲突。论文附件索引跟随最新版本；重复创建不会将索引倒退到最初版本。

## 验证与发布

受影响测试覆盖 JSON-RPC 握手/错误/通知、只读权限、跨账号与旧连接拒绝、创建重试、笔记历史、白板结构与文件版本校验、电子书分页、开放笔记刷新/草稿保护。Rust 测试使用真实 loopback socket 验证消息传输、凭据范围和帧限制。

Windows 交付前应在最终构建的 EXE 上连接 Codex，验证：含空格和中文的安装路径、STDIO 初始化、创建/编辑真实笔记、界面刷新、旧修订拒绝、切换账号后旧连接失效、关闭 Liteasy 后不再可读写。本次未新增安装器构建触发标记，未改变 Windows workflow。

可以先对实际编译出的桌面程序执行以下传输检查（不需要启动 WebView，不操作真实用户资料）：

```powershell
node scripts/check-local-mcp-stdio.mjs .\src-tauri\target\release\liteasy-desktop.exe
```

脚本临时启动模拟的内部桥接端点，使用真实桌面程序的 `--local-mcp` 入口检查继承的标准输入/输出、中文配置路径、JSON 消息、通知无回包和进程正常退出。它验证传输，不替代与 Codex 和真实 Liteasy 资料库的集成验收。

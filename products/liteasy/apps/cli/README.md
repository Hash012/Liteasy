# Liteasy Context CLI

独立的 Node.js 命令行入口，连接 Liteasy 正式 Context API。一次命令后退出，无模型依赖或后台同步。
运行时最低版本见 `package.json`；仓库开发环境使用桌面 `.nvmrc`。

从仓库构建本地发行包：

```bash
cd products/liteasy/apps/cli
npm ci
npm test
npm pack --pack-destination /path/to/artifacts
```

Linux bash 与 Windows PowerShell 均可从同一 `.tgz` 安装：

```text
npm install --global /path/to/liteasy-context-cli-0.1.0.tgz
liteasy --version --json
```

无需启动桌面。先在桌面“个人中心 → 数据管理 → 外部设备访问”生成指定读写归组的凭据。
API origin 使用实际部署地址。交互输入隐藏凭据；自动化可用 `--token-stdin`，不要把 secret 放进命令参数：

```text
liteasy auth login --origin https://YOUR_API_ORIGIN
liteasy auth status --json
liteasy doctor --json
```

默认使用 Windows Credential Manager 或 Linux Secret Service（`secret-tool`）。凭据库不可用时明确报错，
可在登录时选择 `--credential-store session`（每次以 stdin 提供），或 `--credential-store file`（当前用户受限文件）。
配置绑定 origin 和 subject，不能通过临时 `--origin` 把现存凭据发送给另一服务。
`LITEASY_CONFIG_DIR` 可选择配置位置。`auth logout` 仅清除本机凭据；远端撤销在桌面管理入口完成。

写入文件格式见 `../../packages/context-contracts/examples/`。支持 UTF-8 BOM 与含空格的路径。
PowerShell/bash 都优先传文件，避免多层 JSON 字符串转义：

```text
liteasy context add --input "认识 输入.json" --json
liteasy context show ENTRY_ID --json
liteasy context update ENTRY_ID --input correction.json --json
liteasy context history ENTRY_ID --json
liteasy context get --scope personal --query "GPU 压缩" --max-chars 12000 --json
liteasy context list --kind idea --status draft --json
liteasy context use --scope project/vector-db
liteasy context export --scope personal --format markdown
```

`context get` 整条选择；预算为标题加正文的 Unicode code point 数，放不下的条目返回 omitted 入口。
默认只读 active；手机新 Idea 为 draft，使用 `--status draft` 读取，或在桌面整理后保存。
目录绑定只保存范围和可选 origin，不保存 secret，不扩大权限。
成功 `--json` 输出为 `{schemaVersion:"liteasy.cli/v1",result:...}`；诊断/失败只写 stderr。
退出码：0 成功、2 输入、3 身份、4 权限、5 不存在、6 冲突、7 网络/服务、8 协议/能力。

提交前保存一份权限受限的恢复文件。未知结果不显示已保存；错误给出 operationId 和 recoveryFile。
用原输入和操作编号查回执或重试；7 天默认窗口以服务 whoami 为准：

```text
liteasy context receipt OPERATION_ID --json
liteasy context retry --retry /path/to/recovery.json --json
```

超过窗口会拒绝重放，请先核查云端条目。恢复文件含选定正文，可在确认结果后自行删除；没有自动发送器。
修改和删除必须携带 expectedRevision，冲突会保留编辑并报告 currentRevision。

显式 Skills：

```text
liteasy skills install --agent codex --scope user
liteasy skills install --agent claude-code --scope project
liteasy skills status --agent codex --scope user
liteasy skills upgrade --agent codex --scope user
liteasy skills remove --agent claude-code --scope project
```

Codex 使用 `$liteasy-context`、`$liteasy-capture` 等；Claude Code 使用 `/liteasy-context`、`/liteasy-capture` 等。
另外提供 papers、research-fit、reframe、connect。不会自动唤起。升级/卸载遇到用户修改或同名文件会保留并报错。
缺少 shell、Web 或 API 访问时由工作流报告实际缺口，安装 CLI 不代表所有网页 AI 都可调用它。

Zotero 仅导入明确选择的 Markdown 导出快照，不扫描个人库：

```text
liteasy source import zotero-md --file "笔记.md" --library-origin "local-instance:my-pc" --json
```

可提供 `--note-id`（笔记自身身份）和 `--locator`。论文/PDF 回链不会自动成为笔记身份。
原始内容保存为 reference/imported，正文变化默认创建新快照；明确更新使用 `--entry-id`、`--expected-revision`。
同一归组/来源/笔记身份/内容 hash 可识别重复，人工修正不会被再次导入覆盖。

卸载：`liteasy auth logout` 后 `npm uninstall --global @liteasy/context-cli`。
跨平台安装 smoke 与正式 API 集成测试不等同于真实 Windows→已部署云端→Linux 交接；验收证据见仓库 QA 记录。

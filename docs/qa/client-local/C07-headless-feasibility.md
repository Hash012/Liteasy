# C07：CLI / headless 复用边界审计

2026-10-02，基线 `0fba97be`，仅代码审计。本次没有新增 CLI 命令、传输、sidecar 或 headless 成功声明；C07 仍待实施。

现有 `src-tauri/src/main.rs` 在创建 Tauri app 前调用 `agent_host::run_external_mode()`，已有 `--agent-cli` / `--agent-mcp` 参数保留。`agent_host.rs` 的 CLI 将参数数组原样放入请求，通过 Unix socket 发送，等待运行中桌面的事件桥；`useTauriAgentHostBridge.ts` / `agentHost.ts` 最终使用 `agentApplicationService.ts` 与 `agentCliAdapter.ts`。业务执行仍依赖前端运行时。非 Unix 的 `send_external_request` 返回 unavailable，没有 Windows 命名管道。不存在可据此宣称的跨平台、无 GUI 业务执行。

已有 socket 创建模式 0600、旧端点检查和服务端 120 秒等待。仍需单独核验/补齐同用户 peer 身份、输入帧大小、连接并发、客户端读写超时、断连清理和 Windows ACL。不能把当前 socket 存在或业务 `capabilities` 输出当成连接身份验证。

C06 新增的 `FileStore::file_operations(request, checkScope)` 不依赖 AppHandle，GUI 经现有 `note_files_dispatch` 调用它；它复用同一份 grants SQLite、计划、修订检查与回执。因此可作为确定性复制业务的共享端口，不需要另写 CLI 执行器。但直接开放第二进程调用尚不安全：

- C06 任务修改由现有 `note_files.rs::FILE_LOCK` 串行化，锁仅在进程内有效。GUI / CLI 并行修改前需同一数据库内可恢复执行租约或等价跨进程序列化，不能让两个进程覆盖同一逐项回执。
- 当前账号范围来自已验证 `desktop_identity::local_object_scope()`；数据根在 Tauri 初始化过程中解析。无 GUI 入口需要共用身份和数据位置解析，不接受任意 `--scope` 绕过账号边界，也不能悄悄创建另一套状态库。
- 当前 `get` / `list` 会恢复中断意图并持久化状态；它们不是严格只读接口。若先提供只读 status/dry-run，需清楚分离只读加载和恢复，不用“查看状态”暗中开始写文件。
- 非交互复制必须绑定已审查计划摘要、授权 grant 与幂等键。取消/退出应保留逐项 intent/receipt；不增加笼统全权限 `--yes`。

建议下一切片先抽出共用身份/数据根启动服务和跨进程任务租约，再让 GUI 与 CLI 共用一个确定性端口。在 GUI 关闭、DISPLAY/WAYLAND_DISPLAY 缺失、无源码/全局 Node 的真实安装环境中验证同一计划、冲突与回执。仅能本地打印 help 或静态 transport 信息不满足 C07 的“至少一个真实 headless 文件操作”验收。

AI orchestration 仍是 TypeScript。是否打包 Node sidecar 需要独立 ADR、三平台可行性与体积测量；此审计既不选定新 sidecar，也不把现有编排全面移入 Rust。未修改生产服务、网络 MCP、现有 CLI 参数或安装包。

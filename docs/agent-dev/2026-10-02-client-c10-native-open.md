# C10 最小切片：原文件授权与系统打开转交

本切片以 `8d31bf57` 为基线。C10 全卡未完成；独立分支仅交付 Rust 原文件端口、队列、回归和接线要求。最终集成人负责 `main.rs`、平台 JSON 和 C03 前端，不能把本分支的测试当作已接通的系统文件关联证明。

## 已实现

- PDF/EPUB 系统选择器与冷/热启动转交共用进程内、精确单文件、只读授权。不会复制到文献库、上传文件或授权父目录。Markdown 保留现有笔记选择、编辑与版本冲突路径。
- 多文件 argv 保留顺序、中文、空格、`#`；相对路径使用发起实例 cwd；`file:` URL 解码后使用同一入口。HTTP、OAuth、自定义 URL 不取得文件授权；远程 file URL、query、fragment 被拒绝。未知选项之后忽略参数，显式 `--` 后恢复文件解析。
- 每文件最多 100 MiB；每次队列最多 32 项；最多 256 个存活授权。队列溢出返回明确错误，重复文件也不能使溢出被静默吞掉。
- 授权保留只读文件句柄；读取拒绝丢失、改动、符号链接替换及错误账户。实际返回为 Tauri binary `ArrayBuffer`，不把大文件编码成 JSON 数字数组。磁盘读取、原生转交和队列锁等待在 `spawn_blocking` 中；选择器使用 `AsyncFileDialog`。
- `Resumed` 早于数据目录初始化时跳过 watcher 恢复；setup 仍在初始化后启动监听，后续 resume 继续重启和完整校验。

授权只在本次进程有效。关闭/失败/替换/账户切换时前端应调用 release。release 验证授权原 scope 与不可预测 id，允许清理已退出账户的授权，不返回数据。冷启动在原生身份恢复前收到的文件归属 `local`；随后进入登录账户不会自动转移该授权，用户须在该账户重新选择文件。重新启动后必须重新选择原文件；原文件没有迁移或写入，既有笔记授权不变。

## 集成要求（由集成人执行）

1. `src-tauri/src/main.rs` 增加 `mod native_open;`。single-instance 原来的空回调替换为：

   ```rust
   |app, argv, cwd| {
       native_open::enqueue_argv(app, argv.into_iter().map(std::ffi::OsString::from), std::path::Path::new(&cwd));
       native_open::focus_main_window(app);
   }
   ```

2. setup 在数据初始化后，前端开始调用前，调用以下入口。队列先在进程内初始化，耗时文件准备异步执行；前端先订阅再 drain，防止初始化竞争：

   ```rust
   native_open::enqueue_argv(app.handle(), std::env::args_os(), &std::env::current_dir()?);
   ```

3. `generate_handler!` 注册 `native_open::{choose_native_open_file, read_native_open_file, release_native_open_file, drain_native_open_requests}`。无需 `manage`，无需添加插件或依赖。原 local-only profile 已允许这些命令，新增回归确保不误判为网络入口。
4. `app.run` 保留现有 Resumed 分支；增加 `#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]` 下的 `tauri::RunEvent::Opened { urls } => native_open::enqueue_urls(app_handle, urls)`。Windows/Linux 文件关联仍由最终平台配置决定，不自动注册为默认应用。
5. 前端端口：choose 输入 `{scope}`，输出 descriptor 或 null；read 输入 `{scope,id}`，输出 `ArrayBuffer`；release 输入 `{scope,id}`；drain 输入 `{scope}`，输出 `{files,errors}`。descriptor 为 `{id,path,fileName,format,sizeBytes,modifiedUnixMs}`，format 为 pdf/epub；error 为 `{code,message}`。scope 复用笔记的 `local` 或 `user:<原生验证 subject>`。
6. 监听 `native-open-files-available`（空 payload）后立即初次 drain；后续事件再次 drain。按 scope 和组件生命周期忽略陈旧响应、释放未使用授权。队列错误必须告知用户。首次 drain 得到空列表不代表 OS 文件关联不可用，也不能当作探测成功。

## 回归证据

环境：Ubuntu 24.04.3 LTS / WSLg / x86_64；Rust 1.98.0（workflow 为 1.98.1，非同版本）；系统 Node 18.19.1，本分支没有执行 Node 构建；集成使用可用 Node 22.13.1（仓库 `.nvmrc` 为 22.23.2）。没有原生 Windows/macOS。

共享 Cargo target 经集成人许可串行使用，命令均在仓库根目录执行，前缀为 `CARGO_TARGET_DIR=/home/tjm/proj/Liteasy/products/liteasy/apps/desktop/src-tauri/target`。

| 命令 | 结果 | 边界 |
| --- | --- | --- |
| `cargo test --locked --no-default-features --manifest-path products/liteasy/apps/desktop/src-tauri/Cargo.toml --test native_open` | 首次 exit 101：新增回归引用的 native 模块不存在 | 基线缺少端口 |
| 同上，添加溢出回归后 | exit 101：8 passed / 1 failed，重复路径队列溢出错误计数为 0 | 先暴露缺口，再修复 |
| 同上，修复后 | exit 0：9 passed / 0 failed | 真实隔离临时文件和 Unix 符号链接，无用户资料，无 Tauri 窗口/IPC |
| `cargo test --locked --no-default-features --manifest-path products/liteasy/apps/desktop/src-tauri/Cargo.toml --bin liteasy-desktop local_dev::tests` | exit 0：2 passed / 0 failed | 开发隔离命令边界 |
| `rustfmt --edition 2021`（本切片三个新增 Rust 文件）及 `git diff --check` | exit 0 | 格式与空白检查 |

`tests/native_open.rs` 用 `#[path]` 编译实际 `native-open/files.rs`，因此不依赖未接线的 `main.rs`；这证明核心端口行为，不证明 `native_open.rs` 命令封装或操作系统已接通。最终集成人必须在接线后执行 `cargo check --locked --all-targets --no-default-features`，受影响测试、桌面 smoke/build/clean contracts。初始 watcher warning 的真实窗口复验也留给集成验证。

## 未完成与下一步

原生 picker 自动化目前受阻；实际 Tauri IPC、冷/热实例转交、macOS Opened、Windows 路径/重解析点/长路径、外置盘/只读权限均未验证。Unix 符号链接检查不替代 Windows 测试。没有执行安装器、签名、公证、升级、三平台一致性验证。没有新增完整能力报告、Reveal 统一端口、退出/活动任务语义或持久文件恢复授权。

下一最小步骤：完成上述接线与 C03 读者消费，使用隔离 fixture 在真实 Tauri 中验证两次实例启动与无丢失转交，再用原生 Windows/macOS 重复验收。撤回本切片只需撤回代码和接线；无 schema、存储迁移、文件副本或写入需要回滚。

# C11：原生候选包验证入口

本切片新增手动工作流 `Desktop platform candidates`，保留现有 Windows 分层 CI 和 NSIS 工作流。它交付可执行的 Linux/macOS 构建与产物证据入口；**没有执行 GitHub 原生构建，不是三平台运行、安装或发布验收完成证明**。

## 选择与执行

合入平台配置及本工作流后，在 GitHub Actions 手动选择包含这些改动的提交所属分支，选择 `linux-x64`、`macos-arm64` 或 `both`。该工作流没有 push、PR、定时或发布触发器，不读取签名秘密，不发布 Release。两个候选均以现有完整前端验证工作流通过为前提。

| 选择 | 原生 runner / Rust target | 候选产物 | 验证范围 |
| --- | --- | --- | --- |
| `linux-x64` | `ubuntu-24.04` / `x86_64-unknown-linux-gnu` | `.deb` | 真实前端、原生 Rust 测试、Release 链接、deb 结构/amd64 声明、生成文件洁净 |
| `macos-arm64` | `macos-15` / `aarch64-apple-darwin` | `.app.tar.gz`、`.dmg` | 真实前端、原生 Rust 测试、Release 链接、app plist/arm64 主程序、DMG 完整性、生成文件洁净 |

工作流首先检查实际 OS、CPU 架构、Rust host 与平台覆盖文件。macOS 使用 Apple Silicon 原生 runner，拒绝 Intel/Rosetta 进程；GitHub 的 runner 列表确认 `macos-15` 为 arm64，工作流还在执行时检查，不能只靠标签。[GitHub runner 说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

Ubuntu 24.04 和 macOS 15 仅是构建候选基线，未据此声明最低受支持系统。Intel Mac、Universal、AppImage 和其他 Linux 发行版不在此切片中。DMG 必须由 Mac 上的 Tauri 工具生成。[Tauri DMG 说明](https://v2.tauri.app/distribute/dmg/)

平台配置由集成人维护：`tauri.linux.conf.json` 的 `bundle.targets` 为 `['deb']`，`tauri.macos.conf.json` 为 `['app', 'dmg']`。本工作流用标准文件名自动合并，不覆盖共享窗口配置；构建与打包显式传递同一 Rust target。[Tauri CLI 配置和 bundle 参数](https://v2.tauri.app/reference/cli/#bundle)

## 工具链、缓存与门禁

复用 `.github/actions/setup-desktop`：Node 版本读 `.nvmrc`，依赖用 `npm ci`；只复用 npm 下载缓存，不缓存或跨系统共享 `node_modules`。Rust 版本由脚本读取现有 `desktop-windows.yml` 的唯一精确版本，不复制版本源。Rust 测试和编译都用 `--locked`，默认 feature 保留；先构建真实 frontend dist，再执行 Rust 测试。

默认 `use-rust-cache=false`，在新 checkout 上不恢复本机编译缓存。显式开启后，Rust cache key 包含 OS、arch、target、Rust pin、npm/Cargo 锁文件与 `test-release-default` profile/features；不缓存应用 crate。缓存不取消任何测试、链接、结构或 cleanliness 检查。再次验证相同代码是否可冷构建时，关闭该选项。

同一 job 保存每个命令的日志，最后执行既有 `check-clean.mjs package-lock.json src-tauri/Cargo.lock ../../packages/shared`。报告步骤在前面失败或跳过后仍执行；缺失、跳过、取消均不会成为 build passed。最终汇总要求选择、完整前端验证、每个选中 matrix job 成功。未选平台不会凭空出现成功报告。

## 产物与状态

每个真正构建成功的产物附带 `.sha256` 与 `.metadata.json`，记录 commit、version、target、OS 基线、字节数、SHA256 和同目录 `verification-report.json` 引用。app 先归档为 tar.gz，以保留执行位和符号链接。失败的构建只上传已存在的日志/报告，不输出冒充成功的候选包。

报告沿用 `liteasy.client-verification/v1` 形状，独立记录 `build`、`rust_locked`、`artifact_structure`、`native_ipc`、`native_window_file_events`、`installer_smoke`、`upgrade_recovery`、`signing`、`notarization`。Rust 单元测试可能含模拟对象，因此不被记为真实 IPC 测试；package inspection 也不代表安装或启动成功。

此工作流始终令 `release_ready=false`。原生 GUI/IPC、文件关联、拖拽、凭据操作、安装升级、签名、公证和运行时测试驱动器端口排除都为 `not_run`，不能由打包成功推导通过。Apple 工具链可能产生 ad-hoc 签名，这不是受信任分发签名验收。

## 当前官方原生自动化方案评估（2026-10-02）

Tauri 官方现推荐 `@wdio/tauri-service`。默认 embedded provider 依靠 `tauri-plugin-wdio-webdriver` 在测试 app 内运行 WebDriver，覆盖 Windows、Linux、macOS。直接驱动官方 `tauri-driver` 仍仅覆盖 Windows/Linux；不能把这条路径的 Mac 限制套到整个 WebdriverIO 方案。[Tauri WebDriver 说明](https://v2.tauri.app/develop/tests/webdriver/)

`tauri-plugin-wdio` 提供更丰富的后端访问/日志功能；mock IPC 是独立能力，不证明真实写入。官方要求插件只用于测试，给出条件注册和 feature gating 示例；embedded server 默认端口为 4445，需要避免进入正式构建。下一切片应使用显式测试 feature、专用能力配置和独立 target 目录，真实写入临时 fixture；正式包同时检查依赖、能力清单与实际监听端口。[WebdriverIO 插件配置](https://webdriver.io/docs/desktop-testing/tauri/plugin-setup/)

**此切片未安装或验证 WebdriverIO 版本，也未引入测试插件、生产 IPC 或监听端口。** 版本锁定与真实三平台兼容验证属于尚未完成的 C11 原生 E2E 切片，不能把官方示例的 `latest`/宽版本范围当成已验证固定依赖。现有 Playwright 浏览器回归保留其 Web 层意义；普通 Chrome/Vite 或模拟 invoke 结果不升级为 WKWebView/WebKitGTK/WebView2 原生证据。

## 本地验证与回退

本次执行环境为 Ubuntu 24.04.3 / WSL2 x86_64。CI 脚本回归使用可用 Node 22.13.1；仓库 `.nvmrc` 请求 22.23.2。本机 Rust 1.98.0 与 workflow 1.98.1 不同，本切片没有用替代版本声称原生构建通过。执行记录见 `C11-verification.json`。

```bash
bash .github/scripts/lint-workflows.sh
node --test .github/scripts/*.test.mjs
git diff --check
```

报告单测使用明确的合成 artifact 字节和临时目录，包括 tar 执行位/链接往返；它们不代表真实 deb/DMG 生成。没有安装桌面 npm 依赖，没有启动产品、访问生产或调用模型。

改动仅为 CI、辅助脚本和文档，无用户数据格式/迁移变化。回退此提交即可移除手动候选入口，不涉及用户数据恢复；Windows gate 及默认桌面行为不变。下一项最小任务是在集成后的精确提交上显式运行 `linux-x64` 冷构建，记录真实结果；具备 Mac runner 后再执行 `macos-arm64`，随后补真实 native IPC 和安装验收。当前不能宣称 C11 全卡完成。

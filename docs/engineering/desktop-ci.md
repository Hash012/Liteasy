# 桌面基础 CI 与按需 Windows 安装包

普通分支提交、PR 和 merge queue 运行 **Desktop CI** 的基础检查。只有明确请求时才运行完整测试、Windows Release 编译和 NSIS 打包。最终检查 **Desktop CI ready** 汇总本次所选流程；失败、取消、跳过或缺失的必要任务不能产生通过结果。

## 如何触发

| 操作 | 执行流程 |
| --- | --- |
| 普通 branch push / PR / merge group | 基础 CI |
| push 的最新 commit message 包含 `[build-installer]` 或 `[windows-installer]` | 完整测试与 Installer |
| PR 当前标题或正文包含上述标记 | 完整测试与 Installer |
| PR 带 `build-installer` 或 `windows-installer` 标签 | 完整测试与 Installer |
| Desktop CI → Run workflow，勾选 `build-installer` | 完整测试与 Installer |
| Build Windows installer → Run workflow | 完整测试与 Installer |

标记和标签不区分大小写，提交/PR 文本中的标记必须带方括号。例如：

```text
fix: repair desktop data migration [build-installer]
```

push 只读本次 **HEAD commit** 的消息，不因为批量推送里某个旧提交有标记而重打包。PR 读当前标题、正文、标签，不扫描提交历史或评论；PR 修改标题/正文、添加/移除标签和新提交均重新判定。保留 PR 标记意味着后续更新继续完整构建，移除全部标记后回到基础流程。merge queue 默认只运行基础流程。

**普通 main/fallback 提交和 `v*` 标签不再直接触发旧的安装包工作流。** 版本发布也需显式请求；可先对待发布提交使用上述标记，或使用 GitHub CLI 的 `gh workflow run windows-installer.yml --ref <tag>` 从标签构建。Actions 手动入口需要工作流已存在于默认分支。

## 两档检查

| 检查 | 基础 CI | 完整 Installer |
| --- | --- | --- |
| Workflow 语法及触发/汇总逻辑回归 | 是 | 是 |
| 锁定 npm 依赖安装、图标/NSIS 资源存在且受 Git 管理 | 是 | 是 |
| TypeScript、生成 schema 与仓库一致 | 是 | 是 |
| Windows 文件名大小写冲突、资源契约回归 | 是 | 是 |
| Windows Rust 开发模式编译（含测试代码类型检查） | 是 | — |
| 完整桌面测试（两分片） | — | 是 |
| 生产前端及发布端点校验 | — | 是 |
| Windows Rust 宿主测试实际运行 | — | 是 |
| 默认 custom-protocol 特性、Release EXE 编译与链接 | — | 是 |
| NSIS 打包与安装包上传 | — | 是 |

基础 Windows 命令是 `cargo check --locked --all-targets --no-default-features`：使用现有 `devUrl` 对应的真实开发模式，不创建虚假 dist，不运行 Vite、宿主测试、Release 链接或 NSIS。它可以提前发现 Windows 条件编译、类型、依赖、构建脚本和当前图标资源的问题，但不能证明生产资源嵌入、Release 链接或打包成功。

文件名大小写回归单独执行，覆盖曾造成 `PdfAnnotationReview.tsx` 与 `pdfAnnotationReview.ts` 在 Windows 冲突的问题。`tsc` 本身排除测试目录，不能替代此检查。资源验证当前覆盖图标和 NSIS 显式文件项；未来新增 `bundle.resources`/`externalBin` 时需要扩展检查。

生成文件和锁文件使用 Git 状态检查，已暂存、未暂存以及新生成但未追踪的 schema 都会报错。完整流程只在前端全部成功后启动 Windows 打包；没有自动重试失败测试或 `continue-on-error`。

## 共用配置与缓存

- `.github/workflows/desktop-ci.yml`：事件判定、两档路由、汇总结果。
- `.github/workflows/desktop-frontend.yml`：基础前端检查，按 `full-tests` 加载两分片完整测试。
- `.github/workflows/desktop-windows.yml`：共用 Windows 环境，按 `build-installer` 选择开发编译或完整构建。
- `.github/workflows/windows-installer.yml`：保留手动入口，复用同一套完整流程。
- `.github/actions/setup-desktop/action.yml`：共用 Node 版本、npm lockfile 和安装方式。
- `.github/scripts/installer-policy.mjs`：从事件 JSON 读取标记，只输出固定布尔值，事件原文不进入 shell。

Node 由桌面 `.nvmrc` 指定，Rust 固定 1.98.1，Windows runner 使用 `windows-2025-vs2026`；Actions 固定提交 SHA。Windows 发布端点与 Rust 参数在共用 Windows 工作流中定义，避免两档配置分叉。Summary 记录工具链和镜像版本。

npm 缓存下载包，但每次仍执行 `npm ci`；Cargo 缓存依赖，键包含工具链、锁文件和镜像环境。应用 crate 根据当前代码重新编译，缓存不替代验证。普通 PR 只恢复 Cargo 缓存；分支 push 可以保存。基础 `check` 与 Release 使用不同编译 profile，不能承诺缓存后完整构建无编译成本。

同一事件/ref 的新运行会取消旧运行；push 和 PR 分别检查提交与模拟合并结果，可能各跑一次。同一个 PR 标记更新会取消此前该 PR 的运行。冷缓存仍可能需要安装依赖和编译 Rust；实际耗时须由 GitHub 首次运行记录。

## 验证边界与仓库设置

- 基础绿灯代表基础检查通过；完整绿灯代表本次完整测试、Release 编译和 NSIS 打包通过。两者均不替代 Windows 安装/升级、UI 及真实模型服务验收。
- fork PR 使用普通 `pull_request` 和 `contents: read`，不采用 `pull_request_target`，不传发布密钥。fork 首次运行仍受 GitHub 的审批策略约束。
- 可把 `Desktop CI ready` 配置为 main 的 required check，并使用最新分支要求或 merge queue。此代码变更没有自动修改远端 Ruleset/Branch protection；该检查平时只要求基础档。
- 这里只覆盖桌面/Windows 构建边界，不代表 Liteasy API、Intuecho、marketing 等独立服务的完整 CI。

## 本地复现

从仓库根目录：

```bash
bash .github/scripts/lint-workflows.sh
node --test .github/scripts/*.test.mjs
```

在 `products/liteasy/apps/desktop` 使用 `.nvmrc` 指定的 Node：

```bash
npm ci --no-audit --no-fund
npm run ci:contracts
npm run ci:smoke
cargo check --locked --all-targets --no-default-features --manifest-path src-tauri/Cargo.toml
```

最后一条只有在 Windows 执行才能验证 Windows 分支。本地 Linux 可证明开发模式无需 dist，但不能代替 MSVC 验证。完整构建命令、发布端点及顺序见共用 Windows workflow；前端全量测试可运行 `npm test -- --shard=1/2` 和 `npm test -- --shard=2/2`。

参考：[GitHub 触发事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)、[复用工作流](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)、[缓存可见性](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)、[官方 Windows runner 镜像](https://github.com/actions/runner-images)、[Rust 1.98.1](https://github.com/rust-lang/rust/releases/tag/1.98.1)。


## 本次本地验证（2026-09-16）

- actionlint 1.7.12：所有 workflow/action 语法通过。
- Node CI 脚本测试：76 项通过，覆盖事件策略、YAML 路由约束、失败汇总及真实 Git 仓库中的文件漂移。
- `npm run ci:contracts` 通过；`npm run ci:smoke` 的 8 项资源/大小写测试通过。
- 将 `TAURI_CONFIG.build.frontendDist` 显式指向不存在的目录后，Linux `cargo check --locked --all-targets --no-default-features` 通过，证实轻量路径无需生产 dist；未声称完成 Windows 验证。
- `npm run build` 通过，生产资源检查 152 项通过；保留既有大 chunk 提示。
- 本地前端命令使用 Node 20.20.2，Cargo 使用 Rust 1.98.0；GitHub workflow 仍使用上述固定 Node/Rust 配置。Windows runner 与完整 Installer 的新路由尚待提交推送后首次运行验证。

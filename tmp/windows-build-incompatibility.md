# Windows build incompatibility log

本文件记录 Windows installer workflow 中已确认或正在验证的平台差异。修改共享 schema、Fluent overlay、测试并发、Tauri 资源或 GitHub Actions runtime 时，应先复查这里的规则。

## 2026-09-11: Windows icon resource path audit

- 收到的外部日志：Rust crate `liteasy v0.2.0` 的 `build.rs:18` 调用 Windows 资源编译器后报 `resource.rc(1) : error RC2135 : file not found: assets\\liteasy.ico`；同一日志还声称监听 `assets/icon.ico`。对这份日志而言，直接失败原因确实是资源路径不可读，不是测试或 `strip`。
- 当前 `main` 的仓库事实：Git 只跟踪 `products/liteasy/apps/desktop/src-tauri/icons/icon.ico`；`tauri.conf.json` 引用 `icons/icon.ico`；`build.rs` 只调用 `tauri_build::build()`；当前 crate 是 `liteasy-desktop v0.1.0`。全部 Git ref 和可达历史中都没有 `assets/liteasy.ico`。因此该日志不能由当前 `main` 的 checkout 原样产生，可能来自另一 revision、另一工作区或未提交的 `build.rs`。
- 处理：保持 `tauri.conf.json` 为 Windows 图标的唯一配置源，不添加重复的 `assets/liteasy.ico`。新增 `verify-tauri-resources.mjs`，在前端 production build 和 Windows job 的 Rust 编译前检查：配置路径存在、仍为规范路径 `icons/icon.ico`、文件头是有效 ICO，并在 CI 中确认文件已被 Git 跟踪。
- Workflow：完整 jsdom 前端测试移到 Linux quality job；Windows installer job 依赖它，并先执行资源契约检查，再执行 Rust、production build 和 NSIS。这样平台无关质量门仍会阻断发布，而 Windows jsdom/Fluent 调度差异不会阻止真正的 Windows 编译。
- Review 规则：图标改名时只能修改 `src-tauri/icons/` 与 `tauri.conf.json` 中的规范引用，不要在 `build.rs` 再维护一份手写 `tauri-winres` 路径；提交前运行 `npm run verify:tauri-resources -- --require-git-tracked`。若日志中的 crate 名、版本或 `build.rs` 行号与仓库不符，先记录 workflow 的 head SHA 和 checkout ref，不要用复制文件掩盖来源错位。

## 2026-09-10: generated JSON schema line endings

- 失败位置：`visualizationArtifactSchema.test.ts` 的逐字节 schema 校验。
- 症状：Linux 生成内容使用 LF；Windows checkout 将已提交 JSON 转为 CRLF，导致语义相同的 schema 在逐字节比较时失败。
- 根因：共享 schema 没有声明固定的 Git 行尾策略。
- 修复：在 `.gitattributes` 中将 `products/liteasy/packages/shared/visualizationArtifact.v1.schema.json` 固定为 `text eol=lf`，保留严格的逐字节测试。
- Review 规则：凡是由脚本生成并执行 byte-for-byte 校验的跨 runtime 契约，都必须显式声明行尾；不要在测试中把两边都 normalize 后掩盖仓库内容漂移。

## 2026-09-10: Fluent Menu to Dialog event race

- 失败位置：`LibraryPaneFileManagement.test.tsx` 打开“编辑论文分类与标签”。
- GitHub 证据：[workflow run 34475846740](https://github.com/Hash012/Liteasy/actions/runs/34475846740)、[workflow run 34483682899](https://github.com/Hash012/Liteasy/actions/runs/34483682899) 与 [workflow run 34496344000](https://github.com/Hash012/Liteasy/actions/runs/34496344000) 都在 Windows `Test desktop frontend` 失败。
- 症状：`MenuItem` 的 click 已关闭菜单，但随后找不到 `role="dialog"`。失败 DOM 中既没有菜单，也没有 Dialog。
- 第一次根因推断：菜单 action 与 Dialog outside-dismiss 发生竞争。提交 `c122b41c` 将 Menu 改为受控状态并在关闭后通过 effect 打开 Dialog。
- 反证与回退：run `34496344000` 使用 `c122b41c` 后 Library 测试仍失败，同时不经过 Menu 的 `PaperResourceTab` 第二次翻译 Dialog 也无法打开。因此 `c122b41c` 的单一 Menu 竞争解释和修复都不充分；该业务组件补丁已回退。
- 当前诊断：Windows runner 上的 jsdom、Fluent portal 与 Tabster focus/inert 生命周期存在系统性调度差异；它影响重复打开以及从另一 overlay 打开 Dialog，但并未证明真实 WebView2 中的产品交互失败。
- Review 规则：不要根据 Windows jsdom portal 失败继续向业务组件逐个加入定时器或状态补丁。业务状态和 overlay smoke 应拆分测试；真实 focus/portal 行为应使用浏览器或 Windows WebView 驱动验证。

## 2026-09-11: installer gate architecture

- 旧 workflow 在 Windows 上先运行全部 2,070 项前端 jsdom 测试；公开的 run `34496344000` 在 Rust、production build 和 NSIS 步骤之前停止，不能用它证明上述 `assets\\liteasy.ico` 错误。
- 修复：完整前端单测在 Linux job 作为质量门；Windows job 依赖该 job，先运行 Tauri 资源路径契约，然后执行 Rust tests、production build 和 NSIS 打包。
- 建议：Windows 全量 jsdom 套件改为定时诊断任务且不阻断 Installer；关键 Fluent overlay 另建真实浏览器/WebView smoke。
- 本地打包：优先使用 Windows 机器或 VM 运行 Tauri NSIS build。生成安装包不要求部署 `development/dev-cloud` 或正式 API；服务只用于安装后的联网功能验收。
- 不建议：从 Linux 交叉编译作为常规发布路径。Tauri 官方将该方式描述为限制较多、仅在 Windows VM 或 CI 不可用时采用的最后手段。

## 2026-09-10: desktop test worker pressure

- 症状：高核心数 Linux 环境使用 Vitest 默认 worker 数时，jsdom UI 与动态 renderer import 会争抢 CPU，使既有 5–15 秒测试 deadline 随机超时。
- 根因：测试套件包含大量 jsdom 实例、PDF 解析和可视化动态模块，默认按机器核心数扩张 worker 不适合该负载。
- 修复：桌面 Vitest 配置固定 `maxWorkers: 2`。Windows run 在该配置下没有再出现 renderer 或通用 timeout 失败。
- Review 规则：不要删除 worker 上限来缩短理想环境中的耗时；先用完整 `npm test` 验证资源受限 runner 的稳定性。

## Non-blocking warning

- GitHub 曾警告 `actions/checkout@v4` 与 `actions/setup-node@v4` 的 action runtime 从 Node.js 20 强制迁移到 Node.js 24；这不是资源编译或测试失败原因。
- Workflow 已升级到 `actions/checkout@v5` 与 `actions/setup-node@v5`。`setup-node` 配置的应用测试 Node.js 20 与 action 自身 runtime 是两件事。

## Current verification

- `npm run verify:tauri-resources -- --require-git-tracked`：确认 1 个 Tauri 图标资源存在、ICO 格式有效、路径规范且被 Git 跟踪。
- 新增的资源路径测试以及 `LibraryPaneFileManagement.test.tsx`、`PaperResourceTab.test.tsx`：13 项通过。
- 完整 `npm test`：312 个测试文件通过、2 个跳过；2,068 项测试通过、4 项跳过。
- `npm run build`：schema 生成、TypeScript、Vite production build 与 151 个 production asset 校验全部通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：68 项通过。
- Windows run `34496344000`：2,064 项通过、4 项跳过、2 项 Fluent Dialog 测试失败；此前 Menu sequencing 修复未通过 Windows 验证。

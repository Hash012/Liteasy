# Windows build incompatibility log

本文件记录 Windows installer workflow 中已确认或正在验证的平台差异。修改共享 schema、Fluent overlay、测试并发或 GitHub Actions runtime 时，应先复查这里的规则。

## 2026-09-10: generated JSON schema line endings

- 失败位置：`visualizationArtifactSchema.test.ts` 的逐字节 schema 校验。
- 症状：Linux 生成内容使用 LF；Windows checkout 将已提交 JSON 转为 CRLF，导致语义相同的 schema 在逐字节比较时失败。
- 根因：共享 schema 没有声明固定的 Git 行尾策略。
- 修复：在 `.gitattributes` 中将 `products/liteasy/packages/shared/visualizationArtifact.v1.schema.json` 固定为 `text eol=lf`，保留严格的逐字节测试。
- Review 规则：凡是由脚本生成并执行 byte-for-byte 校验的跨 runtime 契约，都必须显式声明行尾；不要在测试中把两边都 normalize 后掩盖仓库内容漂移。

## 2026-09-10: Fluent Menu to Dialog event race

- 失败位置：`LibraryPaneFileManagement.test.tsx` 打开“编辑论文分类与标签”。
- GitHub 证据：[workflow run 34475846740](https://github.com/Hash012/Liteasy/actions/runs/34475846740) 与 [workflow run 34483682899](https://github.com/Hash012/Liteasy/actions/runs/34483682899) 都在 Windows `Test desktop frontend` 失败；第二次 run 已通过 schema 校验并完成其余 2,069 项测试，只剩 Dialog 未挂载。
- 症状：`MenuItem` 的 click 已关闭菜单，但随后找不到 `role="dialog"`。失败 DOM 中既没有菜单，也没有 Dialog。
- 平台差异：Linux/jsdom 本地单测和完整套件可通过，Windows runner 的 Fluent overlay dismissal 调度会让同一次 pointer/click 序列影响刚挂载的 sibling Dialog。
- 根因：菜单 action 同步设置 Dialog 的 controlled `open` 状态；菜单尚未完成 dismissal 时 Dialog 已挂载，当前交互可能立即触发 Dialog 的 outside-dismiss，再把 `metadataEditorEntry` 清空。
- 修复：沿用 `ArtifactLibraryPane` 的既有模式，将论文 Menu 设为受控状态。菜单项只记录 pending editor entry 并关闭 Menu；effect 在 Menu 的 `open` 明确变为 false 后才初始化并打开 Dialog。
- Review 规则：从 Fluent `Menu`、`Popover` 等临时 overlay 打开另一个受控 `Dialog` 时，不要在同一个 pointer/click task 中挂载目标 overlay；先等待源 overlay 的受控状态关闭，再由 effect 执行 pending action，并保留从真实菜单项进入的集成测试。

## 2026-09-10: desktop test worker pressure

- 症状：高核心数 Linux 环境使用 Vitest 默认 worker 数时，jsdom UI 与动态 renderer import 会争抢 CPU，使既有 5–15 秒测试 deadline 随机超时。
- 根因：测试套件包含大量 jsdom 实例、PDF 解析和可视化动态模块，默认按机器核心数扩张 worker 不适合该负载。
- 修复：桌面 Vitest 配置固定 `maxWorkers: 2`。Windows run 在该配置下没有再出现 renderer 或通用 timeout 失败。
- Review 规则：不要删除 worker 上限来缩短理想环境中的耗时；先用完整 `npm test` 验证资源受限 runner 的稳定性。

## Non-blocking warning

- GitHub 当前警告 `actions/checkout@v4` 与 `actions/setup-node@v4` 的 action runtime 从 Node.js 20 强制迁移到 Node.js 24。
- 该警告不是上述 run 的失败原因；workflow 中 `setup-node` 配置的应用测试 Node.js 版本仍是单独概念。升级 action major version 前应按官方 release notes 单独验证。

## Current verification

- `LibraryPaneFileManagement.test.tsx` 连续运行 5 次通过。
- 完整 `npm test`：311 个测试文件通过、2 个跳过；2,066 项测试通过、4 项跳过。
- `npm run build`：schema 生成、TypeScript、Vite production build 与 151 个 production asset 校验全部通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：68 项通过。
- Windows runner 对 Menu → Dialog 修复的最终确认：等待修复提交后的新 workflow run；Linux 本地结果不能替代这一步。

# Repository Guidelines

## 项目结构与模块组织

三个产品主体位于 `products/`：`liteasy/` 是桌面软件与正式业务 API，`intuecho/` 是论坛 Web/API/契约，`marketing/` 是独立营销站。公共账号生命周期适配器位于 `platform/identity-service/`；部署入口位于 `deployment/`；本地开发服务、工具和测试数据位于 `development/`；文档位于 `docs/`；历史材料位于 `archive/`。

桌面端为 Tauri + React + TypeScript，位于 `products/liteasy/apps/desktop/`。界面壳层在 `src/app/layout/`，跨功能编排在 `src/app/controllers/`，领域模块在 `src/app/features/`，全局样式在 `src/app/styles/`，测试在 `src/tests/`；Rust 宿主在 `src-tauri/`。

`development/dev-cloud/` 是仅限本地的真实开发 API。`products/liteasy/services/api/` 是 PostgreSQL/S3 正式服务边界；不得把 readiness 或仓库实现描述为生产环境已验收。`products/intuecho/services/api/` 使用独立业务数据库，不得与 Liteasy API 共享连接池或凭据。

保持桌面依赖方向：`layout -> controllers -> features -> shared types / clients`。`AppShell` 只负责组合；跨模块行为进入 controller。

## 构建、测试与开发命令

```bash
cd development/dev-cloud && npm start
cd products/liteasy/apps/desktop && npm run dev
cd products/liteasy/apps/desktop && npm run tauri dev
cd products/liteasy/apps/desktop && npm test && npm run build
cd products/liteasy/apps/admin && npm test && npm run build
cd products/liteasy/services/api && npm test
cd products/intuecho && npm test && npm run build
cd platform/identity-service && npm test
```

`dev-cloud` 需要 Node.js 20+。本地密钥写入 `development/dev-cloud/.env.local`，不得提交密钥或敏感配置。

## 代码与命名

代码目录使用小写 `kebab-case`，业务域使用稳定产品名；不要新增 `misc`、`temp`、`new`、`final` 等含糊目录。TypeScript 使用两空格缩进、双引号和分号。React 组件使用 `PascalCase`，Hook 使用 `useThing`，其他 TypeScript 文件与函数使用 `camelCase`。Rust 代码遵循 `rustfmt`。

功能代码进入对应 feature；feature 不得导入 layout 或 `AppShell`。开发专用实现不得进入 `products/*/services`；生产服务不得依赖 `development/`。

## Fluent 2 界面与图标基线

GitHub `main` 的 `7c0da2c` 提交引入的 Fluent 2 图标与布局是产品界面基线：

- 保留图标优先活动栏、紧凑分层面板、4-8px 圆角、浅边框和低层级阴影。
- 交互组件优先使用 `@fluentui/react-components`；图标使用 `@fluentui/react-icons`，不使用 emoji 或混入其他图标库。
- 图标按钮必须有可访问名称和悬浮提示；状态不能仅通过颜色表达。
- 不把模型、实现方式或开发状态作为常驻界面文案。

合并 UI 改动时保留现有 `FluentProvider`、Fluent 依赖、活动栏和布局 token，不覆盖当前用户改动。

## 测试指南

桌面测试放在 `products/liteasy/apps/desktop/src/tests/`，命名为 `*.test.ts(x)`；`AppShell.test.tsx` 只保留 smoke 和关键集成路径。服务测试使用 Node test runner，与服务模块同目录并命名为 `*.test.mjs`。稳定测试数据放在 `development/test-data/`，运行生成物不得提交。

提交前运行受影响测试；桌面代码、依赖、资源或构建配置改动还应运行 `npm run build`。纯文档改动按下述分级规则验证。

## CI 预防与故障处理规则

目标是在本地和低成本检查中发现问题，再进入完整 Windows Installer 构建。规则以仓库现有脚本为准，不另外维护一套容易漂移的检查实现。

### 按改动选择验证范围

以下 npm 命令在 `products/liteasy/apps/desktop/` 执行；其他产品改动运行对应模块的测试与构建。

| 改动范围 | 推送前最低验证 |
| --- | --- |
| 仅文档或说明 | `git diff --check`，核对引用的路径、命令与现有实现；不因文档改动运行完整测试或安装包构建 |
| 桌面代码、测试、资源、依赖或配置 | 受影响测试、`npm run ci:smoke`、`npm run build`；在干净提交上运行 `npm run ci:contracts` |
| Rust 宿主 | 受影响 Rust 测试，以及 `cargo check --locked --all-targets --no-default-features --manifest-path src-tauri/Cargo.toml`；涉及默认 feature 的测试前先构建真实前端 |
| CI workflow、复合 action 或 CI 脚本 | 仓库根目录执行 `bash .github/scripts/lint-workflows.sh` 和 `node --test .github/scripts/*.test.mjs`，再运行改动直接影响的检查 |
| 待交付安装包 | 上述相关检查通过后，在最终提交上请求完整 Installer CI，确认测试、Release 链接、NSIS、cleanliness 和上传均成功 |

- 开始前检查分支、工作区和改动范围；保留用户已有修改。Node 版本读取桌面 `.nvmrc`，Rust 版本读取 Windows workflow，不在本文复制易过期的版本号。依赖安装使用 `npm ci`，Cargo 验证使用 `--locked`；有意升级依赖时同步提交锁文件。
- 普通提交不添加 `[windows-installer]`。需要安装包验证或用户明确要求时才使用；push 策略只检查 HEAD 提交消息，因此标记必须在本次推送的最后一个提交上。PR 标题、正文中的标记或 `windows-installer` / `build-installer` label 也会启用完整流程，不要在持续开发的 PR 上无意保留。手动运行可使用 `build-installer` 输入。
- 每项验证对同一份未变化的代码通过一次即可；只有新改动影响结果、发生失败或有明确未解决疑点时才重跑。跨模块修改扩大测试范围；不要把反复运行全套 CI 当作定位方法。
- 缺少本地工具或 Windows 环境时，记录未验证项并使用现有 CI 验证；不得把 Linux 检查或不同工具链的结果表述为 Windows Installer 已通过。

### 生成文件、路径与版本保持一致

- `products/liteasy/packages/shared/*.schema.json` 必须由 `.gitattributes` 统一为 `text eol=lf`，生成器保持 LF 输出。新增生成文本文件时同时确认换行策略；不要依赖开发机的 `core.autocrlf` 默认值。
- 修改 schema 定义或生成器后，运行对应生成命令并提交应受版本控制的产物；再次生成应得到相同内容。出现批量 modified 时先比较实际内容与 `git ls-files --eol`，区分内容变化和 CRLF/LF 漂移。换行规则变更只对相关路径执行 `git add --renormalize`，检查暂存差异。
- `check-clean` 会同时拒绝已暂存、未暂存和未跟踪的变化。有意修改锁文件或 schema 时，先审查并提交，再在干净提交上重新生成、检查；也可在隔离的临时提交/worktree 上验证。不能把“已暂存”当作 clean，不能为过门禁丢弃正确的生成结果。
- 涉及桌面构建、依赖或生成契约的修改，在提交后、推送前运行原有检查（桌面目录）：`node ../../../../.github/scripts/check-clean.mjs package-lock.json src-tauri/Cargo.lock ../../packages/shared`。如果已经在相同代码上通过 `ci:contracts`，无需重复运行。不得删除此门禁、缩小范围规避失败、添加 `continue-on-error`，或把生成器改成输出 CRLF。
- 新增或重命名模块时禁止文件名仅大小写不同，所有 import 必须与磁盘名称大小写一致；仅大小写重命名通过中间文件名执行 `git mv`。用 `ci:smoke` 检查命名和 Tauri 资源，安装器需要的资源必须受 Git 跟踪，不能仅存在于本地。
- 版本变更必须同步 `package.json`、`package-lock.json` 的根版本和根包版本、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 的应用包版本、`src-tauri/tauri.conf.json`。交付前核对现有 release/tag 与已交付版本，选择未占用且更高的版本；不要因模板或合并回退应用版本，也不要顺带更新无关依赖。

## 提交与拉取请求

提交使用简短祈使式主题，常用 `feat:`、`test:`、`docs:`。

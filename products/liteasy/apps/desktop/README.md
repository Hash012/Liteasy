# LiteasyClaw Desktop

这是 LiteasyClaw 当前桌面产品入口，技术栈是 Tauri + React + TypeScript。

## 目录

```text
products/liteasy/apps/desktop/
  src/
    App.tsx
    main.tsx
    app/
      layout/        Shell、pane、顶部栏、全局 dialog
      controllers/   shell-facing model/actions 适配层
      features/      领域功能模块
      styles/        全局样式
    tests/           Vitest / Testing Library 测试
  src-tauri/          Tauri / Rust 桌面壳
  package.json
  vite.config.ts
```

## 开发运行

推荐同时启动 dev-cloud 和 Vite（首次运行前先安装两处依赖）：

```bash
cd development/dev-cloud && npm install
cd ../../products/liteasy/apps/desktop && npm install
npm run dev
```

默认打开 `http://127.0.0.1:1420`，dev-cloud 默认位于 `http://127.0.0.1:8787`。仅启动 Vite 前端：

```bash
cd products/liteasy/apps/desktop
npm install
npm run dev:desktop
```

启动完整 Tauri 桌面应用：

```bash
cd products/liteasy/apps/desktop
source "$HOME/.cargo/env"
npm install
npm run tauri dev
```

如果要体验云账号、组织、推荐、元数据同步等能力，请先在另一个终端启动：

```bash
cd development/dev-cloud
npm start
```

dev-cloud 默认读取 `development/dev-cloud/.env.local` 作为本地密钥配置。要使用 DeepSeek，请把 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL` 和 `LITEASY_MODEL_PROVIDER=deepseek` 写到该文件；只有显式设置 `LITEASY_DEV_CLOUD_ENV_FILE` 时才会改用其他 env 文件。

## 开发测试账号

桌面端没有预置账号。启动 dev-cloud 后，在桌面的账号对话框选择注册，建议使用：

```text
昵称：测试人员自己的姓名或工号
邮箱：qa.<姓名或工号>@liteasy.local
密码：个人密码管理器生成的 12–128 位值
```

账号保存在本机 dev-cloud 数据库中；不要把密码写入源码、README 或提交。相同邮箱可登录 Intuecho，但 Desktop 获取的是 `liteasy-desktop` 会话，不能把该 token 交给论坛 Web。管理员账号不通过桌面公开注册，按 [dev-cloud README](../../../../development/dev-cloud/README.md#开发测试账号) 单独引导。

## 测试与构建

```bash
cd products/liteasy/apps/desktop
nvm install
nvm use
npm ci
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Node 版本由 `.nvmrc` 固定，并由 GitHub Actions 共用；没有 nvm 时安装其中指定的版本即可。
测试沿用成功构建时的 120 秒上限，为 jsdom 交互和渲染器冷加载留出时间；这不是性能验收阈值。
必须先运行 `npm run build` 再直接执行 `cargo test` / `cargo check`：Tauri 默认启用
`custom-protocol`，`generate_context!()` 编译时需要嵌入 `dist`。Cargo 不会执行
Tauri CLI 的 `beforeBuildCommand`；本机残留的 `dist` 会掩盖全新 checkout 的失败。

Windows 安装包 workflow 会在 `main` / `fallback` 提交、`v*` 标签或手动触发时运行，
顺序为前端测试、Windows 前端构建、Rust 测试、NSIS 打包和 artifact 上传。
在 Windows 上可执行 `npm run tauri -- build --bundles nsis -- --locked` 进行打包。
依赖使用已提交的 `package-lock.json` 和 `Cargo.lock`，不通过重新解析依赖修复构建。

安装包使用 workflow 中的 staging 服务地址；两次前端构建共享同一组 `VITE_*` 环境变量，
并通过 `npm run verify:production-assets -- --require-release-endpoints` 检查地址已写入产物。
本地开发构建不要求这些地址。workflow 只上传 GitHub artifact，不自动发布到 staging。

这条构建链路参考成功提交 `2cd75574144c09393fca664efab900631b2a1c5a`，恢复前端先于
Rust 的顺序、Node 22、staging 地址和当前用户安装/快捷方式钩子；保留现有业务功能、
依赖锁及当前版本号。Windows 安装、启动和已有版本升级仍需用实际安装包验收。

## 模块结构

核心依赖方向：

```text
layout -> controllers -> features -> shared types / clients
```

当前 controller：

- `src/app/controllers/useWorkspaceSelectionController.ts`
- `src/app/controllers/useCloudAccountController.ts`
- `src/app/controllers/useArtifactWorkflowController.ts`
- `src/app/controllers/useKnowledgeSyncController.ts`
- `src/app/controllers/useOrganizationShellController.ts`

主要 feature：

- `workspace` / `selection`
- `agent-runtime` / `actions` / `skills`
- `assistant`
- `artifacts`
- `import` / `retrieval`
- `account` / `network`
- `models` / `settings`
- `collection` / `recommendations` / `metadata`
- `organization`
- `library` / `profile`

更完整的模块图：

[`docs/engineering/project-structure-overview.html`](../../../../docs/engineering/project-structure-overview.html)

## 开发规则

- 不要把新业务状态继续加到 `AppShell`。
- 跨模块组合先进 `src/app/controllers/`。
- feature 模块不要导入 `layout/AppShell`。
- 新增模块逻辑写 focused tests。
- `AppShell.test.tsx` 只放 smoke 和关键集成路径。
- 修改 UI 前先找对应 `layout` 或 `features` 文件，不要直接堆全局样式。

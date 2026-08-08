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
npm test
npm run build
```

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

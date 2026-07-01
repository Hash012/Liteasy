# LiteasyClaw Desktop

这是 LiteasyClaw 当前桌面产品入口，技术栈是 Tauri + React + TypeScript。

## 目录

```text
LiteasyClaw/desktop/
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

仅启动前端：

```bash
cd /home/octopus/Liteasy/LiteasyClaw/desktop
npm install
npm run dev
```

启动完整 Tauri 桌面应用：

```bash
cd /home/octopus/Liteasy/LiteasyClaw/desktop
source "$HOME/.cargo/env"
npm install
npm run tauri dev
```

如果要体验云账号、组织、推荐、元数据同步等能力，请先在另一个终端启动：

```bash
cd /home/octopus/Liteasy
node LiteasyClaw/services/dev-cloud/server.mjs
```

## 测试与构建

```bash
cd /home/octopus/Liteasy/LiteasyClaw/desktop
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

```text
/home/octopus/Liteasy/project-docs/engineering/project-structure-overview.html
```

## 开发规则

- 不要把新业务状态继续加到 `AppShell`。
- 跨模块组合先进 `src/app/controllers/`。
- feature 模块不要导入 `layout/AppShell`。
- 新增模块逻辑写 focused tests。
- `AppShell.test.tsx` 只放 smoke 和关键集成路径。
- 修改 UI 前先找对应 `layout` 或 `features` 文件，不要直接堆全局样式。

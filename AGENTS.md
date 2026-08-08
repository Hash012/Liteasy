# Repository Guidelines

## 项目结构与模块组织

三个产品主体位于 `products/`：`liteasy/` 是桌面软件与正式业务 API，`intuecho/` 是论坛 Web/API/契约，`marketing/` 是独立营销站。公共账号生命周期适配器位于 `platform/identity-service/`；部署入口位于 `deployment/`；本地开发服务、工具和测试数据位于 `development/`；文档位于 `docs/`；历史材料位于 `archive/`。

桌面端为 Tauri + React + TypeScript，位于 `products/liteasy/apps/desktop/`。界面壳层在 `src/app/layout/`，跨功能编排在 `src/app/controllers/`，领域模块在 `src/app/features/`，全局样式在 `src/app/styles/`，测试在 `src/tests/`；Rust 宿主在 `src-tauri/`。

`development/dev-cloud/` 是仅限本地的真实开发 API，不得提供演示账号或 mock 业务结果。`products/liteasy/services/api/` 是 PostgreSQL/S3 正式服务边界；不得把 readiness 或仓库实现描述为生产环境已验收。`products/intuecho/services/api/` 使用独立业务数据库，不得与 Liteasy API 共享连接池或凭据。

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

提交前运行受影响测试；桌面改动还应运行 `npm run build`。

## 提交与拉取请求

提交使用简短祈使式主题，常用 `feat:`、`test:`、`docs:`。每个提交只处理一个聚焦主题。PR 说明用户可见或架构变更、验证命令和所需配置；UI 改动附截图，明确 mock/demo 限制。

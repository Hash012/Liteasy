# Repository Guidelines

## 项目结构与模块组织

核心产品代码位于 `LiteasyClaw/`。桌面端为 Tauri + React + TypeScript，位于 `LiteasyClaw/desktop/`：界面壳层在 `src/app/layout/`，跨功能编排在 `src/app/controllers/`，领域模块在 `src/app/features/`，全局样式在 `src/app/styles/`，测试在 `src/tests/`；Rust 桌面宿主在 `src-tauri/`。

`LiteasyClaw/services/dev-cloud/` 是本地 Node.js 演示 API，`LiteasyClaw/scripts/` 存放演示数据重置和 smoke 检查脚本。工程、产品和 QA 文档放在 `project-docs/`，历史或生成材料放在 `archive/`。

保持依赖方向：`layout -> controllers -> features -> shared types / clients`。`AppShell` 只负责组合；跨模块行为应进入 controller，而非继续堆入壳层或 feature。

## 构建、测试与开发命令

在相应包目录中执行：

```bash
cd LiteasyClaw/services/dev-cloud && npm start  # 启动 8787 端口的本地 API
cd LiteasyClaw/desktop && npm run dev           # 启动 Vite 与开发云
cd LiteasyClaw/desktop && npm run tauri dev     # 启动完整桌面应用
cd LiteasyClaw/desktop && npm run build         # 类型检查并构建生产包
cd LiteasyClaw/desktop && npm test              # 运行 Vitest
cd LiteasyClaw/services/dev-cloud && npm test   # 运行 Node 内置测试
```

`dev-cloud` 需要 Node 20+。本地模型密钥写入 `LiteasyClaw/services/dev-cloud/.env.local`，不得提交密钥或其他敏感配置。

## 代码风格与命名

遵循现有 TypeScript 风格：两空格缩进、双引号和分号。React 组件使用 `PascalCase`，Hook 使用 `useThing`，其他 TypeScript 文件与函数使用 `camelCase`。功能代码放入对应 feature 目录；feature 不得导入 `layout` 或 `AppShell`。Rust 改动应放在 `src-tauri/src/` 并遵循 `rustfmt`。

## 测试指南

桌面端使用 Vitest 和 Testing Library。新增聚焦测试放入 `LiteasyClaw/desktop/src/tests/`，命名为 `*.test.ts` 或 `*.test.tsx`；`AppShell.test.tsx` 仅保留 smoke 和关键集成路径。云服务测试使用 Node 测试运行器，与服务模块同目录并命名为 `*.test.mjs`。提交前运行受影响测试；修改桌面端时还应运行 `npm run build`。

## 提交与拉取请求

近期历史以简短祈使式提交为主，常用 `feat:`、`test:`、`docs:` 前缀，例如 `feat: add workspace selection validation`。每个提交只处理一个聚焦主题。

拉取请求应说明用户可见或架构变更，列出已运行的验证命令，并在可用时关联 issue 或设计文档。UI 改动附截图；明确说明 mock/demo 限制和所需本地配置。

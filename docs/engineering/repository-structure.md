# Repository structure and naming

## Organization rule

仓库采用业务域优先结构：三个用户可见主体放在 `products/`，跨产品平台能力放在 `platform/`，环境编排放在 `deployment/`，本地开发支持放在 `development/`。代码、文档、历史材料和生成物不能混放。

桌面打包配置与桌面应用共同位于 `products/liteasy/apps/desktop/src-tauri/`；分发自动化按 GitHub 固定约定保留在 `.github/workflows/`。安装包和构建目录是生成物，不新建源码级 `distribution/` 副本。服务器部署定义只进入 `deployment/`，不能复用桌面分发流程。

依赖方向：

```text
products -> platform contracts / public service APIs
deployment -> products and platform runtime entrypoints
development -> products and platform test/development entrypoints
products and platform production code -X-> development
```

Liteasy 与 Intuecho 使用独立业务数据库、迁移账号和连接池。公共身份服务只处理身份生命周期，不拥有业务数据。

## Naming rule

- 代码目录使用小写 `kebab-case`；产品域使用稳定业务名：`liteasy`、`intuecho`、`marketing`。
- 通用层级使用复数名词：`apps`、`services`、`packages`、`assets`。
- 单一运行服务使用职责名：产品域内使用 `api`，跨产品服务使用 `identity-service`。
- TypeScript/JavaScript 源文件遵循现有 `camelCase`，React 组件使用 `PascalCase`。
- 带日期的计划、规格和交接文档使用 `YYYY-MM-DD-topic.ext`。
- 禁止新增 `misc`、`temp`、`new`、`old`、`final`、`backup2` 等无法表达所有权或生命周期的名称。

历史中文文档可保留可读标题；移动或新建时优先使用稳定、可搜索的主题名，不为统一语言而制造无意义改名。

## Placement checklist

新增内容前依次判断：

1. 用户直接使用的产品功能，进入对应 `products/<domain>`。
2. 跨产品且不拥有业务数据的平台服务，进入 `platform/`。
3. 部署环境、迁移编排或基础设施验证，进入 `deployment/`。
4. 只在开发/测试运行的服务、工具或稳定数据，进入 `development/`。
5. 当前设计和运行说明进入 `docs/`；不再有效但需保留的材料进入 `archive/`。

每个可独立运行或部署的部分必须有 README，至少说明职责、边界、入口、配置、运行和验证方式。

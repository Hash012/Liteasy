# Liteasy shared data

这里保存 Liteasy 产品内部多个运行端共同读取、且需要版本控制的稳定数据。当前 `disciplineCatalog.json` 是学科目录真源，由桌面画像界面和本地开发 API 读取。

本目录不放运行缓存、用户数据、密钥或通用工具函数。修改目录结构或字段时，必须同时验证桌面构建与 `development/dev-cloud` 测试。

## 运行与验证

本包只有受版本控制的静态数据，没有独立进程或 `package.json`。修改后从仓库根目录运行其两个消费者的验证：

```bash
cd products/liteasy/apps/desktop && npm run build
cd ../../../../development/dev-cloud && npm test
```

## 开发测试账号

读取或修改共享数据不需要账号。本目录不得存放用户清单、测试密码、token 或任何环境凭据。

## 研究对象契约

`object.v1.schema.json`、`objectRef.v1.schema.json`、`objectAnchor.v1.schema.json`、
`objectRelation.v1.schema.json`、`boardPlacement.v1.schema.json`、`contextRef.v1.schema.json`
和 `objectTransfer.v1.schema.json` 由桌面无 React 依赖的对象契约生成：

```bash
cd products/liteasy/apps/desktop && npm run schema:objects
```

桌面构建会重新生成并检查这些文件。六类对象使用严格的类型化内容，未知类型仅允许安全读取和导出。
这些新增契约供本地对象仓库使用；旧 `/v1/agent-artifacts` 仍读写 `liteasy.agent-artifact/v1`，
不能向旧端点提交 object envelope。P0 未新增云对象写入或同步端点。

## 生成内容与资源契约

`authoredArtifact.v1.schema.json` 定义可视化幻灯片和层级大纲，
`authoredResourceFile.v1.schema.json` 定义 `.slides.json` / `.outline.json` 的同源文件表示：`content` 保留创作结构，`sources` 保留论文锚点实体和 ContextRef，不复制完整分析正文；
`paperAnchorEntity.v1.schema.json` 定义带固定出处呈现的论文锚点，
`resourceRef.v1.schema.json` 定义明确 scope、provider 和内容版本的资源引用。
通过桌面 `npm run schema:resources` 从 Zod 真源生成，桌面构建同时更新这些文件。
它们是应用层契约；正式 `/v1/agent-artifacts` 继续接收原 v1 记录，
结构化正文和锚点作为可选字段保存，不需要另建正文存储。

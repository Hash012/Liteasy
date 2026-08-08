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

# Intuecho contracts

`@intuecho/contracts` 保存论坛 Web 与 API 共享的请求、响应和领域契约。它不得导入 Web 组件、数据库适配器或运行环境配置。

## 运行与验证

契约变更必须保持调用方同步，并至少运行：

```bash
cd products/intuecho
npm test
npm run build
```

本包没有独立服务或开发服务器；上述命令从论坛根工作区验证契约的所有消费者。

## 开发测试账号

编译和测试契约不需要账号。本包不得包含真实邮箱、密码、token 或环境专用身份配置；需要身份样例时使用测试文件中的非敏感虚构值。

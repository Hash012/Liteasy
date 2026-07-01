# LiteasyClaw Phase 4 三端 Demo 验收指南

这份指南用于验证 LiteasyClaw 在 demo 阶段已经拆出三个入口：客户使用的桌面软件端、服务器部署端、LiteasyClaw 内部运营与运维后台。当前目标是看清三端边界：桌面软件端是客户产品，管理员页面是我们运营和维护团队用于配置 API、管理资源与查看用户/组织情况的后台，不是客户组织空间页面。

## 1. 三端分别是什么

- 客户桌面软件端：`http://127.0.0.1:1420/` 或 Tauri 桌面窗口
- 服务器部署端：`http://127.0.0.1:8787/`
- 内部运营与运维后台：`http://127.0.0.1:8787/admin/`

## 2. 启动顺序

先启动服务器部署端：

```bash
node /home/octopus/Liteasy/LiteasyClaw/services/dev-cloud/server.mjs
```

再启动客户桌面软件端的前端页面：

```bash
cd /home/octopus/Liteasy/LiteasyClaw/desktop
npm run dev
```

最后在浏览器打开内部运营与运维后台：

```text
http://127.0.0.1:8787/admin/
```

## 3. 内部运营与运维后台应该看到什么

打开 `http://127.0.0.1:8787/admin/` 或 `http://127.0.0.1:8787/admin` 后应看到：

- `LiteasyClaw Operations Console`
- `内部运营与运维后台`
- 客户桌面软件端、服务器部署端、内部运营与运维后台三个入口链接
- 平台资源摘要：模型调用配额、存储使用量、待审核队列
- API 策略：默认 Provider、模型接入模式、本地直连策略、策略版本
- 运维下发 API 策略表单：可保存默认 Provider、模型接入模式、本地直连策略
- 用户与账号：活跃客户用户、客户组织数量、待处理支持请求
- 客户组织资源列表：客户组织名、客户侧角色样例、成员数、共享文献库
- 后台任务：例如 `组织共享文献库索引刷新`
- 近期审计：例如 `Admin 更新共享文献库上传权限`
- 运维数据接口 `/v1/admin/governance-dashboard`

也可以直接打开 JSON 接口：

```text
http://127.0.0.1:8787/v1/admin/governance-dashboard
```

该接口应返回三端状态、API 策略、用户与账号概览、客户组织资源列表、配额、后台任务和审计队列摘要。

内部运维团队也可以通过 API 更新 demo 模型策略：

```bash
curl -s http://127.0.0.1:8787/v1/admin/model-policy \
  -H 'Content-Type: application/json' \
  -d '{"defaultProvider":"mock","modelAccessMode":"local_direct","localDirectEnabled":true}'
```

该接口会返回 `updatedBy: internal-ops-demo` 和新的策略版本；桌面端下一次同步模型策略时会读取该配置。

共享文献库目录 manifest 也可以单独验证：

```bash
curl -s http://127.0.0.1:8787/v1/org/shared-library/manifest \
  -H 'Content-Type: application/json' \
  -d '{"organizationId":"org-demo-1","sessionId":"demo-session-1"}'
```

该接口应返回 `folders`、`documents`、`rootFolderId`，用于桌面端像 VSCode 打开文件夹一样切换到组织共享文献库工作区。

## 4. 当前不是生产后台

当前内部运营与运维后台没有真实登录、RBAC、数据库写入、计费、对象存储或真实组织权限。它只用于 demo 阶段验证三端边界：客户在桌面端使用 LiteasyClaw，我们的运营/维护团队在后台管理 API 策略、资源、用户与组织情况。

## 5. 最近验证

- `node --test LiteasyClaw/services/dev-cloud/server.test.mjs LiteasyClaw/services/dev-cloud/providers/openaiResponses.test.mjs`：22 个服务端/Provider 测试通过。
- `cd LiteasyClaw/desktop && npm test`：63 个桌面端测试文件、223 个测试通过。
- `cd LiteasyClaw/desktop && npm run build`：TypeScript 与 Vite 生产构建通过。

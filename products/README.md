# Product domains

`products/` 只存放用户或运营人员直接使用的产品主体，以及与主体强内聚的业务 API/契约。

- `liteasy/`：桌面客户端、管理端、Liteasy 正式 API 和共享产品数据。
- `intuecho/`：论坛 Web、独立论坛 API 和接口契约。
- `marketing/`：独立静态营销站。

跨产品基础能力进入 `platform/`；开发替身、测试数据和工具进入 `development/`；部署编排进入 `deployment/`。

## 运行与验证

以下链路用于同时测试 Liteasy 的原生桌面能力、dev-cloud，以及 Desktop 与 Intuecho
之间的本地联调。要求 Node.js 20+、Rust/Cargo 和当前操作系统所需的 Tauri 依赖。

首次运行时，从仓库根目录安装三处依赖：

```bash
npm install --prefix development/dev-cloud
npm install --prefix products/liteasy/apps/desktop
npm install --prefix products/intuecho
```

然后分别打开三个终端。每条开发命令都是常驻进程；看到 `node --watch` 后不应按
`Ctrl+C`，而应保留该终端并在下一个终端继续。

如果上一轮 `npm run dev` 或 `npm start` 仍在运行，先在对应终端按 `Ctrl+C` 停止它。
完整联调应让下列流程占用默认端口；如果 dev-cloud 因 `8787` 被占用而自动改用其他
端口，Intuecho 的 `LITEASY_IDENTITY_ENDPOINT` 也必须改成启动日志显示的实际地址。

终端一启动完整 Tauri 桌面壳。Tauri 的 `beforeDevCommand` 会同时启动 dev-cloud 和
Vite，因此不要再单独执行 `development/dev-cloud` 的 `npm start`：

```bash
cd products/liteasy/apps/desktop
npm run tauri dev
```

终端二启动 Intuecho API：

```bash
cd products/intuecho
LITEASY_IDENTITY_ENDPOINT=http://127.0.0.1:8787 npm run dev:api
```

终端三启动 Intuecho Web：

```bash
cd products/intuecho
npm run dev:web
```

默认端口为 dev-cloud `8787`、Desktop Vite `1420`、Intuecho API `4040`、Intuecho
Web `5174`。可在另一个终端检查两个 API：

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:4040/health
```

随后使用 Tauri 窗口测试 Desktop，并在浏览器打开 <http://127.0.0.1:5174> 测试
Intuecho。`npm run dev` 只适合在 <http://127.0.0.1:1420> 快速预览界面；它没有
Tauri 原生宿主，不能完整验证本地文件系统、目录导入、持久缓存或系统浏览器登录。

dev-cloud 从 `development/dev-cloud/.env.local` 读取模型和外部服务密钥。未配置真实
provider 时，相应联网能力会明确返回不可用。若还要测试 dev-cloud 内嵌管理台的
Intuecho 治理代理，在启动终端一前设置
`INTUECHO_API_ENDPOINT=http://127.0.0.1:4040`，并按
[dev-cloud README](../development/dev-cloud/README.md#开发测试账号) 引导本地管理员。

静态营销站：

```bash
python3 -m http.server 8080 --directory products/marketing
```

以上命令覆盖仓库支持的本地产品联调链路，不等于生产环境全功能验收。正式 Liteasy
API 和管理端依赖 PostgreSQL、S3、OIDC 等部署配置，不属于默认本地桌面链路；各产品
的完整前置条件和测试命令见其 README。

## 开发测试账号

`products/` 不保存固定账号或密码。Desktop 与 Intuecho 的本地联调账号由测试人员在 dev-cloud 注册，建议使用 `qa.<姓名或工号>@liteasy.local`；管理账号由 dev-cloud 引导脚本或目标环境 IdP 创建。Marketing 无登录。详细边界见仓库根 [README](../README.md#开发测试账号)。

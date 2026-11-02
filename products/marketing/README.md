# Liteasy marketing site

这是与 Liteasy 软件、Intuecho 论坛并列维护的静态营销站。入口为 `index.html`，样式和交互分别位于 `styles.css` 与 `app.js`，静态素材位于 `assets/`。页面没有运行时依赖。

## 运行与验证

从仓库根目录运行契约测试：

```bash
cd products/marketing && npm test
```

本地预览：

```bash
cd products/marketing && npm run preview
```

打开 `http://127.0.0.1:8080`。部署时只发布本目录的静态文件，不把桌面源码、论坛源码、开发配置或文档复制到站点根目录。

桌面与移动端浏览器验证需要仓库中已安装的 Liteasy Desktop Playwright 依赖。启动预览后运行：

```bash
MARKETING_BASE_URL=http://127.0.0.1:8090 npm run verify:browser
```

验证截图写入 `/tmp/liteasy-marketing-desktop.png` 和 `/tmp/liteasy-marketing-mobile.png`，不提交到仓库。

## 体验申请

营销站没有登录功能，不接收 Liteasy 或 Intuecho 的账号密码。

页面默认向同域 `/api/waitlist` 提交 JSON 申请。Staging Caddy 将这个地址转发给 Liteasy API；由 API 保存 PostgreSQL 申请记录，再为私有 OSS 安装包生成短时 `downloadUrl`。表单保存后自动开始下载，安装包未配置时只确认申请已记录。当前为提交后自动发放，不含人工审批或邮箱验证。

配置位于 `deployment/staging/templates/liteasy-api.env.example`：设置 `LITEASY_WAITLIST_ORIGIN` 开启申请入口，`LITEASY_WAITLIST_INSTALLER_KEY` 指定同一私有 Bucket 中的 `installers/` 下 EXE，`LITEASY_WAITLIST_DOWNLOAD_TTL_SECONDS` 默认 600 秒（允许 60 至 3600 秒）。复用 API 的 AWS 环境凭据和 `LITEASY_S3_BUCKET`、`LITEASY_S3_REGION`；要求 `LITEASY_S3_PROVIDER=aliyun-oss`，下载使用官方 OSS SDK 的 V4 签名和公网 HTTPS 地址，不经过 ECS 传输安装包。

先执行新增的 `029_marketing_waitlist.sql` 迁移，再部署 API 和网关。安装包未找到或 OSS 不可用时返回明确错误，但已保存的申请不会丢失。网关覆盖客户端 IP 请求头，API 按来源 IP/邮箱限制每 10 分钟 5 次、全局每分钟 100 次；记录 IP 哈希，不保存原始 IP。下载 URL 有效期内可重复使用和转发，不是一次性链接，过期后需重新提交申请。不要把 Bucket 或安装包 ACL 改成公开读。

申请数据表为 `marketing_waitlist_applications`，包含邮箱、身份、研究领域、问题和时间。前端源码与静态站点不包含凭据或固定下载地址；目前跨域提交不受支持，应通过同域网关提供接口。

下载网络需要加速时，先在 OSS 控制台开启 Bucket 传输加速，再设置 `LITEASY_WAITLIST_TRANSFER_ACCELERATION=true` 并重新创建 API 容器。安装包检查和下载签名将使用公网加速域名，签名地域保持 Bucket 实际地域。该选项默认关闭，不改变业务文献的 S3 Endpoint；启用会产生额外传输加速费用。

## 页面图片

首页使用 `assets/new/program-main.webp`，五步阅读分别使用 `workflow-1.webp` 到 `workflow-5.webp`；步骤切换支持淡入、局部聚光、轻微平移和系统减少动态效果设置。依据章节使用 `proof.webp`；论文阅读和结构表达使用 `paper-read.webp`、`mindmap.webp`。页面使用无损 WebP，PNG 原图保留，完整图片可从工作流下方链接打开。

首页背景优先下载；下方配图延迟加载。工作流进入视口附近后依次预加载其余步骤，点击时复用已加载资源，避免打开页面时同时下载全部截图。替换 PNG 后，应重新生成同名 WebP 并一起上传（例如 `cwebp -lossless -m 6 assets/new/program-main.png -o assets/new/program-main.webp`）。静态部署需要包含这些 WebP 文件。

科学图解为 `assets/science-optics.svg`，使用页面的浅纸色、绿色和橙红色展示凸透镜光路示意。数学与几何、过程演示保留现有示意；视觉重绘入口已移除。`thin-reading produce.png` 暂不展示，五步流程直接展示阅读结果。

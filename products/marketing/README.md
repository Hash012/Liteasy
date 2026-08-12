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

页面默认向同域 `/api/waitlist` 提交 JSON 申请。部署在不同 API 域名时，可以在加载 `app.js` 前设置 `window.LITEASY_WAITLIST_URL` 覆盖该地址。服务端在安装包可用时返回短时 `downloadUrl`，页面会在申请保存成功后自动开始下载；安装包未就绪时只确认申请已记录，不会显示虚假的下载成功状态。

预发布环境的服务配置示例位于 `waitlist/.env.example`。只有经过评审和签名的 Windows 安装包才能写入 `WAITLIST_INSTALLER_PATH`；`WAITLIST_DOWNLOAD_SECRET` 使用独立随机值并只保存在服务器运行配置中。下载地址包含短时签名，不能绕过体验申请直接访问。

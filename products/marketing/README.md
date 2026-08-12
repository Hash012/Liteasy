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

部署页面需要在加载 `app.js` 前设置公开的 `window.LITEASY_WAITLIST_URL`，该地址是体验申请的真实提交目标。未设置时表单会明确提示入口尚未开放，不会显示虚假的提交成功状态。

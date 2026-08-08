# Liteasy marketing site

这是与 Liteasy 软件、Intuecho 论坛并列维护的静态营销站。入口为 `index.html`，样式和交互分别位于 `styles.css` 与 `app.js`，静态素材位于 `assets/`。

## 运行与验证

从仓库根目录本地预览：

```bash
python3 -m http.server 8080 --directory products/marketing
```

打开 `http://127.0.0.1:8080`。部署时发布本目录的静态文件，不把桌面源码、论坛源码、开发配置或文档一起复制到站点根目录。

停止预览时在运行终端按 `Ctrl+C`。本站没有独立构建或自动化测试命令，修改后至少检查首页、导航、响应式布局和体验申请表单的失败提示。

## 开发测试账号

营销站没有登录功能，不需要开发测试账号，也不应接收 Liteasy 或 Intuecho 的账号密码。

体验申请表单需要部署页面在加载 `app.js` 前设置公开的 `window.LITEASY_WAITLIST_URL`。未设置时表单会明确提示入口尚未配置，不会伪造提交成功；当前仓库没有提供申请数据接收后端。

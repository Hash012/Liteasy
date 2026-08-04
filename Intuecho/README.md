# Intuecho MVP

独立于 LiteasyClaw 的文献研究讨论 Web MVP。Liteasy 在未来通过版本化 Public API 创建上下文草稿并读取精简推荐；本项目不读取 Liteasy 的本地 PDF、私有笔记或数据库。

## 已实现的演示闭环

1. 浏览研究主题、论文与公开用户帖子。
2. 从研究主题、论文页、页眉发布入口或“模拟从 Liteasy 带入选区”入口创建草稿。
3. 进入当前 Web 页面右侧的发布抽屉，发布用户帖子；关闭后保持原页面与滚动位置。
4. 输入内容会自动保存为个人草稿，可在“我的发帖”的“草稿”分栏继续编辑或删除；已发布内容可在同页切换查看；未开始输入的 Liteasy 上下文草稿仍会在 30 分钟后过期。
5. 研究主题页有“在本主题发帖”入口；页眉发布入口要求先搜索已有主题或创建新主题。
6. 帖子可选择是否显示原文引用，并可添加最多 5 个标签；标签可以从帖子卡片或页眉搜索框进入搜索。
7. 发布结果回到原页面，并能参与“有帮助 / 有误导性”评价。每位用户对同一条内容只保留一个信号，重复点击撤销；“有误导性”仅用于后台统计。
8. 发布者可撤回自己的内容；撤回后内容从公开查询和上下文推荐中移除。
9. 页眉右侧的反馈入口会保存产品建议。

## 本地启动

```powershell
cd Intuecho
npm install
npm run dev:api
```

另开一个终端：

```powershell
cd Intuecho
npm run dev:web
```

打开 <http://127.0.0.1:5174>。

API 运行于 `http://127.0.0.1:4040`，本地 SQLite 数据保存在 `services/api/data/intuecho.db`。删除该文件即可恢复演示数据。

## 验证

```powershell
cd Intuecho
npm run build
```

## 目录

```text
apps/web/             React + Vite 论坛界面
services/api/         Fastify + SQLite 本地 API
packages/contracts/   Zod API 契约
```

这是独立 MVP，不会修改 `LiteasyClaw/`。真实 Liteasy 接入应只调用 `POST /v1/drafts/contextual` 与 `GET /v1/contextual-feed`，再打开 `/?draft=<draftId>`；页面加载后会自动滑出右侧发布抽屉。URL 只携带短期 `draftId`，不携带原文、私有笔记或身份令牌。

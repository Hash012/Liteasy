# LiteasyClaw 最终 Demo 交付说明

本文档用于当前版本的最终交付。

## 1. 当前可交付范围

本版本可作为路演与演示使用，包含以下主链路：

- 桌面端三栏工作台
- 默认未登录进入，本地阅读器退化模式
- 统一轻量登录面板
- 登录后自动接入云端能力
- 云端收藏、云端推荐缓存 / 推荐生成、文献元数据同步
- 组织入口、组织空间、组织共享文献库
- 组织创建 / 加入 / 邀请 / 退出
- 基于会员级别的创建组织权限门控
- 基于组织角色的邀请成员权限门控
- 中栏多模态入口
- 右栏 AI Assistant 三模式入口

## 2. 当前交付口径

本版本是：

- 可部署
- 可演示
- 可继续在其上开发

本版本不是：

- 完整正式 SaaS 成品
- 完整正式认证 / 计费 / 多租户后端

## 3. 已验证结果

已完成以下验证：

```bash
node --test LiteasyClaw/services/dev-cloud/server.test.mjs LiteasyClaw/services/dev-cloud/providers/openaiResponses.test.mjs
cd LiteasyClaw/desktop && npm test
cd LiteasyClaw/desktop && npm run build
```

当前结果：

- `LiteasyClaw/services/dev-cloud` 服务测试通过
- `desktop` 全量测试通过
- `desktop` 构建通过

如需在演示前恢复稳定状态，可依次执行：

```bash
node LiteasyClaw/scripts/reset-demo-data.mjs
node LiteasyClaw/scripts/reseed-demo-data.mjs
node LiteasyClaw/scripts/smoke-roadshow.mjs http://127.0.0.1:8787
```

## 4. 建议部署顺序

### 4.1 启动云端联调服务

本地：

```bash
cd /home/octopus/Liteasy
node LiteasyClaw/services/dev-cloud/server.mjs
```

云端部署时，请参考：

- `project-docs/qa/roadshow-demo-guide.md`
- `project-docs/qa/environment-startup-guide.md`

### 4.2 启动桌面端

前端开发预览：

```bash
cd /home/octopus/Liteasy/LiteasyClaw/desktop
npm run dev
```

桌面窗口：

```bash
cd /home/octopus/Liteasy/LiteasyClaw/desktop
source "$HOME/.cargo/env"
npm run tauri dev
```

## 5. 推荐路演路径

建议按以下顺序演示：

1. 打开桌面端，展示三栏工作台
2. 跳过登录，说明本地阅读器退化模式
3. 打开统一轻量登录面板并完成 Demo 登录
4. 进入组织页，展示组织空间、组织角色、权限门控
5. 展示组织共享文献库切换
6. 返回本地文献库，展示选中文献集和中栏多模态入口
7. 展示收藏、推荐、问答与模型链路
8. 最后说明 `/admin/` 是平台内部运营/运维视角，而非客户组织后台

进入 `/admin/` 时，建议重点讲：

- 这是 LiteasyClaw 平台内部视角
- 可以看到活跃会话数、收藏总数、推荐缓存条目数、客户组织资源
- 可以执行 `重置 Demo 数据` 和 `重新播种 Demo 数据`

## 6. 路演时需要注意

- 用户侧界面不再暴露“开发云”“端点切换”等调试心智
- 说明性内容大多已收为 hover / tooltip
- 组织管理员与平台管理员是两个不同概念
- `basic` 会员只能加入组织，`pro` 可创建组织
- `收藏` 是用户云端长期私有数据，`关联推荐` 是云端缓存；清理缓存不会影响收藏
- 如果演示顺序被打乱，优先用 reset + reseed 把状态拉回稳定基线

## 7. 如果现场异常

优先检查：

- 云端联调服务是否已启动
- 演示环境地址是否正确
- 桌面端是否已恢复或建立 Demo 会话

如果推荐或同步异常，可先回到：

- 组织空间展示
- 本地文献库展示
- 中栏多模态入口展示

这三段是当前最稳定的演示主链。

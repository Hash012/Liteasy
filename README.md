# LiteasyClaw

LiteasyClaw 是一个面向论文阅读与学习的桌面优先科研 agent 工作台。当前仓库已经开始搭建 `desktop` 端原型，目标是逐步实现：

- 本地文献库与工作区
- AI 助手问答、解释、技能驱动的软件控制
- 多模态学习产物
- 用户画像与后续云端扩展能力

当前更准确的理解是：LiteasyClaw 分为“用户交互层”和“agent 工作流层”，桌面 UI 负责承载工作区、对话与结果，真正的理解、检索、生成与审计在 agent workflow 中完成；所有会修改软件状态的行为，都应收敛到受控的 skill/action 边界。

当前术语以这套为准：

- `工作区`：左栏当前可见的目录视图
- `选中文献集`：在当前工作区里勾选并锁定、准备交给 AI 的文件集合
- `导入`：把选中文献集送入 AI 知识引擎，完成解析、切块、索引等预处理
- `分析`：在已导入的选中文献集上，按指定模态启动主工作流

主干是：`工作区 -> 勾选文件 -> 形成选中文献集 -> 导入 -> 选择模态按钮 -> 启动分析`  
右栏自然语言 skill 是导入后的分支能力，不替代中栏模态按钮这条主干。

这份 README 的目标不是写给开发高手，而是让团队里没有软件开发基础的成员也能：

- 知道这个仓库里有什么
- 知道现阶段能看什么
- 知道怎么启动 `desktop`
- 知道哪些目录是源码，哪些只是开发产物

## 0. 本README除0之外是ai生成。0或为人性化的开工指南。
1. 本项目使用 Linux (Ubuntu)开发。
2. 项目结构可以通过README中的其他部分了解。
3. 建议新建分支后开发，提交pr合并。提交pr后群里发一下开发了什么并展示一下效果。
4. 建议人工阅读产品方案原文(`docs/LiteasyClaw_功能与UI设计文档1.0.md`)，技术和产品蓝图( `docs/superpowers/specs/2026-05-10-liteasyclaw-product-blueprint-design.md`)，以上都可修改。
5. 让ai开发可以根据`docs/superpowers/plans`，分阶段开发。每个阶段要喂给ai产品方案原文和每阶段任务（`docs/superpowers/plans`中），并补充强调plans中忽视或理解错误的点。
6. ai开发中可以复用的经验、提示词要留痕，例如`docs/开发协作提示词历史_5.10.md`。新的开发也要借鉴旧的痕迹（尽量不冗余，上例在这点做的不好）。


## 1. 当前项目结构

仓库里当前最重要的目录是：

### `desktop/`

桌面端原型代码目录。

其中：

- `desktop/src/`
  - React 前端界面
- `desktop/src/app/layout/`
  - 应用整体布局
- `desktop/src/app/features/`
  - 功能模块
- `desktop/src/assets/`
  - 前端资源，例如 Logo
- `desktop/src-tauri/`
  - Tauri + Rust 桌面壳
- `desktop/src/tests/`
  - 当前已有的前端测试

### `docs/`

项目文档目录。

其中：

- `docs/LiteasyClaw_功能与UI设计文档1.0.md`
  - 你的产品方案原文
- `docs/qa/`
  - 面向非开发成员的启动和测试说明
- `docs/superpowers/specs/`
  - 产品蓝图与技术方案
- `docs/superpowers/plans/`
  - 分阶段实施计划

### `logos/`

原始 Logo 与形象素材目录。

## 2. 哪些是源码，哪些不是

如果你只是浏览项目，请重点看这些：

- `desktop/src/`
- `desktop/src-tauri/src/`
- `docs/`
- `logos/`

下面这些通常不是“业务源码”，而是运行后自动生成的开发产物：

- `desktop/node_modules/`
- `desktop/src-tauri/target/`
- `desktop/dist/`

它们主要用于本地运行，不需要逐个阅读。

## 3. 当前已经做了什么

当前 `desktop` 已经具备 Phase 2 可验收能力，并完成 Phase 3 组织空间与治理原型的可验收交付：

- 三栏桌面工作台骨架
- 顶部品牌区与 Logo
- 左栏 `我的文献库 / 收藏 / 关联推荐`
- 选中文献集、锁定选择、导入、模态分析入口
- 云账号登录与本地会话恢复
- 云端模型策略同步
- 当前工作区文献元数据同步
- 关联推荐展示、排序、缓存清理
- 推荐或收藏拖入 `我的文献库`
- 问答原文定位、模型链路、审计模型评分
- 云端模型生成和模型审计接口
- Phase 3 VSCode 式左边栏、组织页/组织窗口、个人中心画像配置、学术档案页面、清空画像确认、组织空间摘要、已加入组织列表/切换、成员明细、通知明细、通知已读状态和治理摘要
- 组织共享文献库 demo 文献通过按钮或注册命令以“打开文件夹”方式切换为当前工作区，可显式返回本地文献库
- 右栏 AI Assistant 保持极简对话框，支持统一三模式入口、历史会话、新建会话、语音输入预留 seam、原文定位、模型链路和审计评分展示
- 左栏文献库按工作区母目录显示目录树，支持关联推荐缓存清理、推荐/收藏拖放和组织/本地工作区显式切换
- 左边栏设置承载模型接入策略、云端策略同步和文献元数据同步重试
- 云端服务索引 `/`、组织列表 `/v1/org/list`、组织摘要 `/v1/org/summary`、治理摘要 `/v1/org/governance-summary`、文献元数据同步和模型审计接口

当前测试已经覆盖桌面端核心 store、导入流程、助手、模型策略、推荐、收藏拖拽、元数据同步、模型审计、组织空间摘要、组织切换、共享文献库切换、个人画像、设置页和开发云接口。最近验收命令为 `cd desktop && npm test`、`cd desktop && npm run build`、`node --test services/dev-cloud/server.test.mjs services/dev-cloud/providers/openaiResponses.test.mjs`。

需要注意：当前仍是原型阶段，推荐、解析、审计、账号系统和组织治理中还有演示或 mock 部分。验收前请先阅读 `docs/qa/phase2-known-limitations.md` 和 `docs/qa/phase3-governance-limitations.md`。

## 4. 没有开发基础的人应该先看什么

如果你不是开发人员，建议按这个顺序看：

1. 看产品方案原文  
   路径：`docs/LiteasyClaw_功能与UI设计文档1.0.md`

2. 看技术和产品蓝图  
   路径：`docs/superpowers/specs/2026-05-10-liteasyclaw-product-blueprint-design.md`

3. 看实施计划  
   路径：`docs/superpowers/plans/2026-05-10-liteasyclaw-phase2-sync-and-recommendation.md`

4. 看桌面端启动说明  
   路径：`docs/qa/environment-startup-guide.md`

5. 看 Phase 2 验收指南  
   路径：`docs/qa/phase2-test-guide.md`

6. 看 Phase 3 组织空间测试指南  
   路径：`docs/qa/phase3-test-guide.md`

7. 如果要做云端路演，先看  
   路径：`docs/qa/roadshow-demo-guide.md`

8. 真正启动一次 `desktop`

## 5. 如何完整运行当前产品

当前产品由两部分组成：

- `services/dev-cloud/`：本地开发云服务，提供云账号、组织空间、推荐、模型策略、模型生成和模型审计等 demo API
- `desktop/`：Tauri 桌面端，也是用户真正使用的 LiteasyClaw 产品入口

如果要完整查看当前桌面端的云账号、组织空间、推荐和同步能力，需要打开两个终端：一个运行开发云服务，另一个运行桌面端。

### 终端 1：启动本地开发云服务

在仓库根目录执行：

```bash
cd /home/octopus/Liteasy
node /home/octopus/Liteasy/services/dev-cloud/server.mjs
```

看到下面这行表示本地云端联调服务启动成功：

```text
LiteasyClaw dev cloud listening on http://127.0.0.1:8787
```

这个终端不要关闭。开发云服务地址是：

```text
http://127.0.0.1:8787/
```

内部运营与运维后台地址是：

```text
http://127.0.0.1:8787/admin/
```

注意：`http://127.0.0.1:8787/` 是开发云 API 服务索引，不是 LiteasyClaw 前端页面；`http://127.0.0.1:1420/` 才是前端开发页面。Phase 4 三端 demo 的内部运营与运维后台 `http://127.0.0.1:8787/admin/` 面向 LiteasyClaw 运营/维护团队，用于配置 API、管理资源和查看用户/组织情况。客户使用的是 Tauri 桌面窗口；如果只看前端预览，才使用 `http://127.0.0.1:1420/`。浏览器直接打开 `http://127.0.0.1:8787/v1/account/demo-login` 会使用 GET，但该接口需要桌面端发起 POST 请求；现在服务端会返回带方法说明的 JSON，看到这个提示不代表账号系统坏了。

如果要让模型生成接口调用真实 OpenAI，而不是内置开发演示回答，请在启动开发云服务前设置：

```bash
export OPENAI_API_KEY=你的密钥
node /home/octopus/Liteasy/services/dev-cloud/server.mjs
```

如果你要把当前 demo 服务部署到云端做路演，请优先阅读：

```text
/home/octopus/Liteasy/docs/qa/roadshow-demo-guide.md
```

### 终端 2：启动桌面端完整产品

另开一个终端，在 `desktop` 目录执行：

```bash
cd /home/octopus/Liteasy/desktop
source "$HOME/.cargo/env"
npm install
npm run tauri dev
```

正常情况下会弹出一个桌面窗口。

如果已经安装过依赖，后续通常可以省略 `npm install`，直接执行：

```bash
cd /home/octopus/Liteasy/desktop
source "$HOME/.cargo/env"
npm run tauri dev
```

你当前应该能看到：

- 顶部 LiteasyClaw 品牌区
- 最左侧窄竖栏 `文献库 / 组织 / 个人中心 / 设置`
- 左栏 `Library`，可切换到组织、个人中心或设置
- 中栏 `Reader`
- 右栏 `AI Assistant` 极简对话框
- 顶部微型模型状态指示，模型策略和文献元数据同步详情位于左边栏 `设置` 页面

启动后如需完整验收 Phase 2，请按 `docs/qa/phase2-test-guide.md` 操作；如需验收 Phase 3 组织空间与治理原型，请按 `docs/qa/phase3-test-guide.md` 操作。

### 可选：只看前端页面

如果桌面窗口暂时打不开，也可以先看前端：

```bash
cd /home/octopus/Liteasy/desktop
npm install
npm run dev
```

然后打开终端输出的本地地址，一般是：

```text
http://127.0.0.1:1420/
```

## 6. 启动失败时先检查什么

先执行这些命令：

```bash
node -v
npm -v
cargo --version
```

如果这些命令都能输出版本号，说明基本环境已经具备。

如果 `cargo --version` 失败，先执行：

```bash
source "$HOME/.cargo/env"
```

再重新检查。

如果 `npm run tauri dev` 报错，请优先把：

- 你执行的命令
- 报错最后 20 行
- 你的操作系统环境

发给当前开发负责人。

## 7. 当前协作建议

团队成员协作时，请遵守这些简单规则：

- **新建分支开发，提交pr**
- 看源码优先看 `desktop/src/`，不要把 `node_modules` 当成项目代码
- 不要随手删除 `desktop/package-lock.json`
- 修改 UI 时尽量先在 `desktop/src/app/styles/` 和 `desktop/src/app/features/` 中找对应文件
- 不要把临时截图、导出文件、安装产物混进业务源码目录
- 如果只是验收产品效果，优先看 `docs/qa/` 下的说明

## 8. 关键文档入口

- **产品方案原文**：`docs/LiteasyClaw_功能与UI设计文档1.0.md`
- **技术方案**：`docs/superpowers/specs/2026-05-10-liteasyclaw-product-blueprint-design.md`
- **实施计划**：`docs/superpowers/plans/2026-05-10-liteasyclaw-phase0-1-desktop-core.md`
- **Phase 2 计划**：`docs/superpowers/plans/2026-05-10-liteasyclaw-phase2-sync-and-recommendation.md`
- 环境启动手册：`docs/qa/environment-startup-guide.md`
- Phase 2 测试指南：`docs/qa/phase2-test-guide.md`
- Phase 2 已知限制：`docs/qa/phase2-known-limitations.md`
- Phase 3 组织空间测试指南：`docs/qa/phase3-test-guide.md`
- Phase 3 组织与治理限制：`docs/qa/phase3-governance-limitations.md`
- Phase 4 三端 Demo 验收指南：`docs/qa/phase4-three-end-demo-guide.md`
- 路演部署与演示指南：`docs/qa/roadshow-demo-guide.md`
- 开发协作提示词：`docs/开发协作提示词历史_5.10.md`

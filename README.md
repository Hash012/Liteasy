# Liteasy

Liteasy 是一个面向论文阅读与学习的桌面优先产品。当前仓库已经开始搭建 `desktop` 端原型，目标是逐步实现：

- 本地文献库与工作区
- AI 助手问答、解释、命令控制
- 多模态学习产物
- 用户画像与后续云端扩展能力

这份 README 的目标不是写给开发高手，而是让团队里没有软件开发基础的成员也能：

- 知道这个仓库里有什么
- 知道现阶段能看什么
- 知道怎么启动 `desktop`
- 知道哪些目录是源码，哪些只是开发产物

## 0. 本README除0之外是ai生成。0或为人性化的开工指南。
1. 本项目使用 Linux (Ubuntu)开发。
2. 项目结构可以通过README中的其他部分了解。
3. 建议新建分支后开发，提交pr合并。提交pr后群里发一下开发了什么并展示一下效果。
4. 建议人工阅读产品方案原文(`docs/Liteasy_功能与UI设计文档1.0.md`)，技术和产品蓝图( `docs/superpowers/specs/2026-05-10-liteasy-product-blueprint-design.md`)，以上都可修改。
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

- `docs/Liteasy_功能与UI设计文档1.0.md`
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

当前 `desktop` 已经具备：

- 三栏工作台骨架
- 顶部品牌区与 Logo
- 默认浅蓝灰 UI 配色
- 左栏基础文献库区域
- 右栏基础 AI 助手区域
- Tauri 桌面壳可启动

当前已经写好的测试包括：

- `workspace.store.test.ts`
- `import.store.test.ts`
- `assistant.store.test.ts`

也就是说，现在已经不是“纯静态图”，而是一个开始进入可运行开发状态的桌面端原型。

## 4. 没有开发基础的人应该先看什么

如果你不是开发人员，建议按这个顺序看：

1. 看产品方案原文  
   路径：`docs/Liteasy_功能与UI设计文档1.0.md`

2. 看技术和产品蓝图  
   路径：`docs/superpowers/specs/2026-05-10-liteasy-product-blueprint-design.md`

3. 看实施计划  
   路径：`docs/superpowers/plans/2026-05-10-liteasy-phase0-1-desktop-core.md`

4. 看桌面端启动说明  
   路径：`docs/qa/environment-startup-guide.md`

5. 真正启动一次 `desktop`

## 5. 如何查看 desktop 当前效果

### 方式 A：直接看桌面窗口

在终端执行：

```bash
cd /home/octopus/Liteasy/desktop
source "$HOME/.cargo/env"
npm install
npm run tauri dev
```

正常情况下会弹出一个桌面窗口。

你当前应该能看到：

- 顶部 LiteasyClaw 品牌区
- 左栏 `Library`
- 中栏 `Reader`
- 右栏 `Assistant`

### 方式 B：只看前端页面

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

- **产品方案原文**：`docs/Liteasy_功能与UI设计文档1.0.md`
- **技术方案**：`docs/superpowers/specs/2026-05-10-liteasy-product-blueprint-design.md`
- **实施计划**：`docs/superpowers/plans/2026-05-10-liteasy-phase0-1-desktop-core.md`
- 环境启动手册：`docs/qa/environment-startup-guide.md`
- 开发协作提示词：`docs/开发协作提示词历史_5.10.md`


# Liteasy 环境启动手册

这份文档面向没有软件开发经验的成员，目标是让你可以独立把 Liteasy 当前版本跑起来并检查界面是否正常。

## 1. 你需要准备什么

请先确认电脑上已经具备以下工具：

1. `Node.js`
2. `npm`
3. `Rust`
4. Tauri 运行依赖

如果你不知道是否已经安装，可以把下面这些命令分别复制到终端里执行：

```bash
node -v
npm -v
cargo --version
```

正常情况下，这些命令都会输出版本号，例如 `v20.x`、`10.x`、`cargo 1.x`。

## 2. 在哪里打开终端

如果你使用的是 Ubuntu / WSL：

1. 打开终端程序
2. 进入项目工作区目录

```bash
cd /home/octopus/Liteasy/desktop
```

## 3. 第一次启动前要做什么

第一次运行前，请先安装依赖：

```bash
npm install
```

正常情况下，这一步会下载前端和 Tauri 依赖，并在结束时回到命令提示符。

如果这里失败：

- 先检查网络是否正常
- 再检查 `node -v` 和 `npm -v` 是否能输出版本号

## 4. 如何启动开发云服务

如果你要检查 Phase 2 的账号、云端策略、推荐、文献元数据同步、模型审计，以及 Phase 3 的组织空间入口，请先在仓库根目录启动开发云服务：

```bash
cd /home/octopus/Liteasy
node /home/octopus/Liteasy/services/dev-cloud/server.mjs
```

看到下面这行表示成功：

```text
Liteasy dev cloud listening on http://127.0.0.1:8787
```

浏览器访问 `http://127.0.0.1:8787/` 时会返回开发云服务索引 JSON；桌面端页面请打开 Tauri 窗口或 Vite 地址。

这个终端窗口不要关闭。然后另开一个终端启动桌面端。

如果你只是想看最基础的桌面界面，可以暂时跳过这一步。

## 5. 如何启动界面

在 `desktop` 目录下执行：

```bash
source "$HOME/.cargo/env"
npm run tauri dev
```

正常情况下会发生两件事：

1. 终端里出现开发服务启动日志
2. 桌面上弹出一个名为 `Liteasy` 的应用窗口

如果桌面窗口一时打不开，也可以先看前端预览：

```bash
npm run dev
```

## 6. 看到什么才算启动成功

启动成功后，你应该能看到一个三栏布局窗口：

1. 左栏标题是 `Library`
2. 中栏标题是 `Reader`
3. 右栏标题是 `Assistant`

三个区域都应可见，不应只有空白页，也不应只有浏览器默认文本。最左侧窄竖栏应能看到 `文献库 / 组织 / 个人中心 / 设置`；左栏默认显示工作区文献列表与“交给AI流程”按钮；中栏初始可能显示空态提示；右栏只应看到 AI 助手模式切换、输入框和发送按钮。模型策略与文献元数据同步在左边栏 `设置` 页面，组织空间与组织治理在左边栏 `组织` 页面。

如果要完整检查 Phase 2，请继续按下面文档操作：

```text
/home/octopus/Liteasy/docs/qa/phase2-test-guide.md
```

如果要检查 Phase 3 组织空间入口，请继续按下面文档操作：

```text
/home/octopus/Liteasy/docs/qa/phase3-test-guide.md
```

如果你只想了解当前阶段哪些能力还不是正式生产能力，请看：

```text
/home/octopus/Liteasy/docs/qa/phase2-known-limitations.md
```

Phase 3 组织与治理原型边界请看：

```text
/home/octopus/Liteasy/docs/qa/phase3-governance-limitations.md
```

## 7. 常见问题先看什么

### 情况 1：终端提示找不到 `cargo`

说明 Rust 没有正确安装，先执行：

```bash
source "$HOME/.cargo/env"
```

然后再次检查：

```bash
cargo --version
```

### 情况 2：终端提示依赖安装失败

请记录：

- 你执行的命令
- 报错的最后 20 行

然后反馈给开发同学。

### 情况 3：窗口没有弹出来

先检查终端有没有红色报错信息；如果有，请截图或复制最后一段报错。

## 8. 反馈问题时怎么写

反馈时请至少带上这些信息：

1. 你在哪个目录执行的命令
2. 执行了哪条命令
3. 看到的结果是什么
4. 你预期看到什么
5. 截图或报错文本

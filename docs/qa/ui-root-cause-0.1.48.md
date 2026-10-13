# UI 根因修复与 0.1.48 候选包

实现依据为 `tmp/Liteasy_UI_Root_Cause_Task_Pack.zip`，审计基线为 `6bb59f32d72fcadeb21fcf40449c0a6d9808dff5`。用户标注截图的安装版本、DPR 和字体未知；它们没有被当成本次运行截图。稳定合成资料及原始验收定义保存在 `development/test-data/ui-root-cause/`，初始 `not_run` 清单不冒充执行结果。

## 改动与边界

- 主题继续由 ApplicationThemeProvider / FluentProvider 管理。薄读交互表面使用成对主题 token；科学图、原始 PDF 和导出纸张保持作者颜色。公告使用共享 VisuallyHidden，保留可访问树。
- 助手首页、对话、历史、任务列表、任务详情互斥；会话服务继续拥有隐藏的运行。保存回执绑定 scope、目标和内容修订，空内容没有“已保存”声明。失败任务保留旧结果；生成完成后的保存失败可重试同一结果。
- Studio 使用真实 ComponentTreeView 和受限预览上下文。可视编辑、源码、拖拽、删除、撤销及保存共享草稿；非法源码保留到对应文件。四卡离线教学流程可编辑、预览、保存，不调用模型。布局按容器宽度切换。
- 文献关联清单区分 unknown/loading/ready/error，失败保留上次目录并允许重试；提取视图、笔记白板、产物分组。别名按固定 ref 合并，不按标题抹去修订；打开固定 ref 不静默替换为最新正文。推荐先显示标题和真实理由。
- PDF 预览按 CSS 尺寸、DPR 和像素预算渲染，保留文字层。换源有独立加载身份，复用 canvas 前等待旧 RenderTask 结束。导出 job 与视图分离：关闭不取消，明确取消不发布；保存使用本次冻结 payload，并重新授权。
- Markdown、证据附录、DOCX 的代码、段落和列表语义修复；宽公式采用有说明的完整 TeX 替代，长源段只提示、不改写；续表头明确标识。仍由既有 ExportDocument 编译/渲染链路负责。
- 离线恢复工作区允许既有静态 PDF capability/render/cancel 命令，文件仍落在该隔离资料根；原有禁网、禁凭据和未知命令拒绝规则保留。

## 实际验证与证据

桌面目录运行 `npm test`、`npm run ci:smoke`、`npm run ci:content`、`npm run ci:export`、`npm run ci:ui`、`npm run build`，并在提交的干净 worktree 上运行 `npm run ci:contracts`。Rust 使用 Windows workflow 的锁定工具链，运行受影响 `local_dev` 测试及 `cargo check --locked --all-targets --no-default-features --manifest-path src-tauri/Cargo.toml`。CI workflow 经过原有 lint 和 Node 脚本测试。

原始失败包括真实生产组件的空会话保存假象、任务列表混入 transcript、迟到保存回执、Studio 标题空壳/删除不落入模型，以及真实 PDF.js 同页数换源残留旧画面。导出语义测试另复现代码标点改写、列表拆项、附录段落压平、宽公式无替代。基线薄读暗色 computed style 浏览器测试失败，修改后通过。

全量测试期间发现旧推荐/关联内容文案断言，更新后保留真实交互断言复验。另一次 context 文件大小写改名与正在运行的测试重叠，两个预览权限断言失败；新进程对真实预览及相关权限测试重新验证，未删改安全断言。所有原失败日志保留，最终 CI 再对同一提交运行完整测试。

生产预览使用同一 Vite production 编译与产品 CSS；额外 fixture 入口仅写入忽略的临时 QA 目录，不进入打包的 `dist`。覆盖真实 AppShell 三栏保存/重启路径、助手互斥、Studio 编辑/非法源码/删除撤销、推荐 280/360/480px、深浅色、中文/英文与 200% 显示缩放。真实 PDF.js 覆盖 DPR 1/1.25/1.5/2、fit-width/100%/200%、预算降级、换源、坏文件恢复和文字选择；真实 Chromium 打印检查六页、100 行表格、续表头、代码、脚注和公式源码。

运行证据、64 项逐项结果、命令、源文件 SHA256、最终 commit、Windows 版本与安装包 hash 汇总在本地 `tmp/ui-root-cause-evidence/`。PR 快速门新增 `ci:ui` 与真实组件/Dock 浏览器检查，并保留 `ci:content`、`ci:export`；完整安装包由最终带 `[windows-installer]` 标记的提交触发。Windows WebView 与 Chromium 结果分开记录；CI 安装包成功不等于 Windows GUI 全矩阵通过。

## 数据与回滚

没有替换会话数据库、对象库、产物库或导出 owner。新增助手视图字段向后兼容，未知旧记录保留原文和原始备份；Studio 编辑缓冲与历史只随既有草稿保存。导出 job 缓存仅在内存、按 scope/source 隔离且最多保留八项；旧导出文件不改写。回滚代码前应保留当前用户数据与新增草稿，按正常版本回退流程操作，不删除历史以实现回滚。

所有测试使用合成/离线资料；Windows QA 使用显式 `--recovery-profile` 的独立目录与独立 WebView 数据目录，不停止当前用户的正常 Liteasy 实例。

## 未完成的独立验收

截图已保存并检查，但未经独立人工批准，不能作为已批准黄金基线。用户截图对应真实资料的缺失关联诊断、所有颜色状态的完整人工分类、Word/WPS 的打开和排版，以及所有操作系统多窗口/字体组合不能由本次样例推定。逐项矩阵对部分覆盖和未运行项保留说明，不宣称任务包所有 P0 验收已通过。

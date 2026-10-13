# 0.1.49 速问与界面增量改进

实现基线为 `323d872f`（0.1.48），增量合并 2026-10-13 QuickAsk 任务包，保留上一轮会话、文献库、制作台和导出修复。

## 行为与调用链

旧链为 `PdfReader → usePdfQuickAskController → captureQuickAsk → ObjectWorkbench.ask → Agent session → runWorkspaceAgent → liteasy_asset_action`。仅在模型 transport 提供普通回答时，真实旧生产链出现“模型连续返回无效的工具指令”；旧 UI 同时拒绝空问题。旧测试 mock 整个 `onQuickAsk`，无法发现错误的生产路由。

新链为 `PdfReader → preparePdfQuickAskContext → usePdfQuickAskController → QuickAskService → 既有 ModelGateway → transport → 严格 terminal → 私人批注持久化`。生产集成测试只 mock transport，并断言单次生成、无工具 schema/动作协议、普通 Agent 和上下文托盘不变。流中断及空 completed 不当成完成。只有显式“转到对话”创建以 attempt 标识的独立、幂等目的会话，保留原对话草稿。

PDF 与阅读模式共享零输入入口、四个任务、可选指令和保存状态。自定义替代预设任务意图；全局/本次回答偏好低于明确任务。快捷指令使用现有 settings 真源、scope/CAS、资源注册及版本导入导出。点任务按钮不发请求；最近任务在成功后记忆。

宿主确定性读取选区页和真实摘要/引言标题边界（最多 32 页、500K 字符），限制外的缺失为未就绪；不把开篇全文冒充摘要。缓存按账号、文献修订、提取器和页隔离。结构预算保留整个选段，无法容纳时拒绝；背景按完整块投递，范围去重并保留角色。模型窗口采用现有用户窗口配置，没有宣称自动探测供应商实际窗口。

回答用现有 ContentView 和 Evidence Lens。来源可读/投递不代表独立语义核验。批注仍是唯一答案真源，附加可选版本化来源回执；旧四字段内容完整保留。Rust 归档白名单和 TS 校验同步，未知回执字段不进入可移植归档。关闭仅收起，停止真正 abort；保存失败保留结果并单独重试，不重复生成。

## 界面覆盖与边界

继续使用现有 FluentProvider、Fluent 图标、4–8px 圆角及密集桌面布局。公共原语支持锚定非模态浮层、按实际宽度切换的 Fluent 模态 sheet、焦点恢复、任务按钮、来源披露、状态与安全正文。全局迁移具名清单在桌面 `scripts/ui-surface-inventory.json`；36 个表面接入公共操作原语，449 处 UI 样式映射为语义颜色。科研图形、原文纸色、CodeMirror/Canvas 等保留具名适配。

`ci:ui` 增加 AST/CSS 门禁和反例；现有精确例外记录在 `scripts/ui-exceptions.json`（owner、原因、复核批次）。这不是“所有历史控件全部重写”或“每个表面的所有状态视觉验收通过”的声明。新增越界、第二主题根、独立渲染及未清点表面会被拒绝。

## 验证

按仓库脚本执行受影响测试、完整桌面测试、`ci:smoke`、`ci:contracts`、`ci:content`、`ci:export`、`ci:ui`、构建和 Rust archive/`cargo check --locked --all-targets --no-default-features`；Installer 必须以最终提交的完整 CI 结果为准。测试覆盖真实 controller/gateway 请求、取消/晚到响应、私人批注失败恢复、旧新归档、预设 CAS、显式会话转移、普通 Agent、内容与导出安全。

新增 `quickAsk.browser.spec.ts` 使用真实阅读器与 controller/gateway，只有模型 transport 为合成流：四种宽度 × 浅/深/强制颜色，零输入、任务不发送、流式收起重开、Markdown/数学/表格和刷新恢复。另有 presets 双窗口并发及原语焦点/对比度/触控验证。浏览器验证不代表 Windows DPI/IME 或真实供应商质量。

用户明确要求“仅本地与 CI，不调用付费模型”。`test:quick-ask-live` 是显式授权/配置后可运行的专用入口，本次真实模型矩阵为 `not_run`，不会读取现有凭据或上传论文。Windows 原生只报告实际运行环境；未运行的平台、全 DPI/IME、辅助技术与人工视觉验收不能宣称通过。

本次 70 项证据、命令日志、源文件哈希、截图和 Windows 安装包摘要随交付证据归档提供；中间失败和最终通过保留，未验证项逐项标注。

## 回滚

视觉回滚仅撤回具体表面的原语/样式适配，保留受限执行路由和新增数据解码器。不得回退到速问通用 Agent 工具循环，不删除 settings 中的个人预设、批注正文和固定来源回执。回到 0.1.48 二进制前应备份资料；旧二进制不理解新回执的完整语义，不能用它重新导出并宣称新来源记录仍完整。安装包仅构建与交付，不自动覆盖用户已安装软件或发布生产服务。

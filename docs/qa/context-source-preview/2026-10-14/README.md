# Context / Source Preview 改进记录

输入：`Liteasy_Context_SourcePreview_Review_2026-10-14.zip`。包的源码基线为 `dc1c7bfe`，本轮开发从标题栏拖动修复 `07b2747d` 继续。桌面版本保持 0.1.51；没有安装或替换用户正在运行的程序。

## 实现与边界

| 任务 | 已实现 | 验证或剩余边界 |
| --- | --- | --- |
| T0 | 真实图片解码、最大 320px 光栅图、请求阶段追踪、超时、重试与取消 | PNG/JPEG/SVG 浏览器实际解码绘制；原生存储没有物理中断 API，不能声称所有底层挂起 I/O 已释放 |
| T1 | LF/UTF-16 半开字符选区、字素边界校验、固定快照、来源与 selector 保留 | 精确词语、重复文字、CRLF、emoji、页内 selector 到模型内容回归；旧 PDF 二进制回看及旋转/CropBox 矩阵未完成 |
| T2 | 轻量元数据索引、研究/应用资料、统一查询与 facet、稳定分组排序、跨页选择与引用去重 | 10k 查询实测；缺失历史元数据保持 unknown，不读全库正文猜测 |
| T3 | ResourceLink 共享原文预览、打开保留 fragment、只读 hover、不自动准备全文、Esc 取消定时器 | 来源范围与显示上下文分开；触屏/真实权限/原生长期资源压力仍需验证 |
| T4 | 默认列表、可切图库、无焦点时收回预览列、Notes 按论文分组排序、详情就地展开、结构化内容摘要 | 五张同像素尺寸截图；原截图的私人资料没有用于此轮浏览器测试 |
| T5 | 显式 mention 范围和独立身份、实际短文本、单一显示、点击预览/独立删除、撤销重做、异步与发送偏移保护 | 同名/多次提及/不同版本/Markdown 符号标题回归；真实中文 IME 和跨应用结构化剪贴板未全验 |
| T6 | 新对话首个有效回合命名、受限输入/时间/尝试、模型标题持久化、人工命名优先和版本核对 | 历史载入不启动命名；测试采用受控 gateway，未调用真实模型评估标题质量 |
| T7 | 53 文案候选逐项审阅、225 个界面表面覆盖记录、教学文案迁移帮助、门禁新增负例、中英文新增键 | 361 个有类型键通过缺失检查；这不是全应用所有页面状态的多语言验收 |
| T8 | 90 条验收结果、截图逐项映射、性能数据、验证记录、迁移及回滚说明 | Windows 当前源码实机验收未完成；具体缺项见 acceptance.json |

## 证据

- [90 条验收结果](acceptance.json)：`pass` 只表示所列自动化证据范围内通过；`partial` 和 `not-verified` 均不计为完整通过。
- [截图红字逐项映射](screenshot-checklist.json)：标明对应实现、截图与局限。
- [文案审阅](ui-copy-review.json)：候选原文、决定、来源哈希、owner 和未覆盖运行状态。
- [验证运行记录](validation.json)：包括初跑失败与修复后重跑，避免把中途变更的结果当最终结果。
- [10k 元数据性能](evidence/catalog-query-performance.json)：真实机器采样，非性能承诺。

| 原图 | 本轮浏览器图 | 尺寸 |
| --- | --- | --- |
| notes.png | [S1](evidence/S1-notes.png) | 2048 × 1718 |
| context-papers.png | [S2](evidence/S2-context-papers.png) | 1980 × 1350 |
| context-images.png | [S3](evidence/S3-context-images.png) | 1980 × 1350 |
| context-loading.png | [S4](evidence/S4-context-details.png) | 1980 × 1350 |
| composer.png | [S5](evidence/S5-composer.png) | 891 × 1898 |

S1 使用浏览器应用壳，S2–S5 使用真实产品组件和受控资料；不把截图当作 Windows 或用户原资料验证。S5 聚焦输入框，历史列表与命名由组件/协调器测试覆盖。

## 诊断

Vite 开发应用的同一标签页控制台可读取：

```js
const { previewDiagnostics } = await import('/src/app/features/resource-links/previewRequest.ts');
console.table(previewDiagnostics());
```

只记录最近 200 条请求阶段、generation、revision、耗时和错误码；不记录路径、标题、正文或账号标识，刷新即清空。发布版没有新增全局调试入口，旧版 0.1.50 也没有此诊断。

## 迁移和回滚

1. 没有批量重写或删除用户资料。新增文本锚点可选 `normalization: lf-utf16`；旧锚点继续按原语义解析。捕获通过稳定操作键创建固定快照，重复捕获保持幂等。
2. 新 mention 记录范围与引用身份；历史草稿无范围时原文字保留，引用作为附件显示，不猜同名文本。未实现唯一对应旧稿自动迁移。
3. 查询/分组/排序偏好按 scope 保存，旧 `type:book` 继续表示文献类型。未有来源的旧笔记保持 unknown。
4. 会话增加可选命名状态和 `titleSource: model`。生成 schema 随代码提交。降级客户端可能不理解新增 enum/字段，回滚前备份会话与对象存储；优先回滚 UI 代码并保留新版 schema 读取能力，避免旧客户端覆盖新版记录。原本固定对象/文档不做逆向重写。
5. 本轮没有运行安装包 CI，没有更新用户手册或安装程序，也没有动运行中的 Windows 应用。Windows 只读探测得到 0.1.50，不能据此验收本轮 0.1.51 源码。

## 提交索引

- `07b2747d`：顶部栏鼠标拖动与禁止标题栏文本选中。
- 本目录所在的 `feat: improve context selection and source previews` 提交：T0–T8 代码、回归及证据。可用 `git log --oneline -- docs/qa/context-source-preview/2026-10-14` 定位。

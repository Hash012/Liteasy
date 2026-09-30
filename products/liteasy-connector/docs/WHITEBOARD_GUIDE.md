# Whiteboard / JSON Canvas 使用与兼容说明

## 5 分钟示例

在 ChatGPT 阅读一节“WAL 的顺序要求”，点击标题右侧 ⠿ 发往白板，形成第一张卡片；再拖入你自己的“buffer pool”批注形成第二张卡片。拖动第一张卡片右侧圆点到第二张的左侧，双击连线写下“数据页落盘前，相关 WAL 必须稳定化”。Shift 选中两张卡片，点击“分组”，命名“持久化顺序”。点击“导入 / 导出 → 导出当前 .canvas”，文件放入 Obsidian Vault 后继续整理。

## 支持的格式字段

按 JSON Canvas 1.0：顶层 `nodes` / `edges`；节点 `id,type,x,y,width,height,color`，文本 `text`，链接 `url`，文件 `file,subpath`，分组 `label,background,backgroundStyle`；连线 `id,fromNode,toNode,fromSide,toSide,fromEnd,toEnd,color,label`。导入/导出保留标准可选字段，未知/插件扩展字段丢弃。节点数组顺序在导出中保留；浏览器端将组放在卡片下层，极端交错层次可能与 Obsidian 略有不同。

颜色支持 1–6 或 #RRGGBB；坐标和宽高是整数，可有负坐标，宽高为正。边端点支持 top/right/bottom/left，端部支持 none/arrow。默认尾端箭头沿用 JSON Canvas 规范。

兼容限制：卡片和连线 ID 接受 1–128 个字母/数字/下划线/连字符；坐标绝对值不超过 10,000,000。单卡正文 262,144 字符，标题/标签等也有防御性长度限制。标准允许更宽泛的数据，本实现遇到超限或不支持的 ID/URL 会拒绝导入并显示错误，而不是声称所有第三方 Canvas 都无损。

文本原文保持 Markdown，但不解释 Obsidian 独有双链、插件脚本、Mermaid 等私有扩展；它们保留原文由 Obsidian 决定如何处理。网页卡片只接受不含凭据的 HTTP(S) URL，未实现任意 URI / iframe。`file` 与分组背景只保存路径；不会附带或读取文件，不会把 Obsidian 附件自动传入扩展，也不会从扩展导出附件。

## 安全与存储边界

DOM 拖拽数据只当作内容解析；选区/章节在显式操作时转换为 Markdown，平时不复制全文。Markdown 渲染沿用允许列表 DOM 重建，脚本和事件属性不执行，外部图片默认点击才请求。批注、白板正文只允许扩展管理页面读取，不向 ChatGPT 页面脚本提供跨来源访问接口。未做完整第三方安全审计。

白板是来源内容的快照。标准 `.canvas` 中只包含标准字段，来源通过 Markdown 链接携带；额外插件定位信息仅在本地和全部白板 JSON 中。导出当前 `.canvas` 可在白板写入失败或冲突时备份当前模型，但不包括尚未点“保存卡片”的输入框编辑。

边拖动边强制关闭、未确认成功就断电、不再存在的来源会话、ChatGPT 未渲染的历史节点都存在边界；不宣称这些场景一定能恢复或定位。看到“已保存”意味着扩展已收到事务完成，不是已同步到云端。没有账号同步服务。重要记录请常规导出备份。

## 没有照搬的 Obsidian 能力

没有本机 Vault 自动发现、附件嵌入、网页 iframe、反向链接索引、插件生态、自动布局、卡片边缘重连、右键完整菜单或 AI 生成关系。编辑使用显式保存弹窗，而非 Obsidian 的内联编辑。支持拖动四边端口建立边、双击编辑标签、选中后 Delete 删边。

## 调试

扩展侧栏 DevTools 中运行 `CGRWhiteboardDiagnostics()` 可查看当前板 ID、卡片/边总数、挂载量、Worker、缓存 HTML 编码字节、撤销估算、保存与冲突状态，不包含正文。主页面通过扩展消息 `CGR_DIAGNOSTICS` 读取阅读进度组件诊断。上述代码运行在扩展隔离环境，不是暴露给网页脚本的公共接口。

源文件：`canvas-core.js` 格式模型与校验；`whiteboard-db.js` 事务持久化；`whiteboard.js/css` 编辑器；`markdown-clip.js` 显式选区转换；`content.js` 章节区间、视口回收和发送入口。

规范参考（2026-09-15 核对）：
- JSON Canvas 1.0: https://jsoncanvas.org/spec/1.0/
- Obsidian Canvas: https://help.obsidian.md/plugins/canvas

## 安装后人工验收

用测试对话拖入一节、添加一张批注卡片、联边并修改关系文字，等待“已保存”，关闭侧栏再打开核对；导出 .canvas 到 Obsidian Vault 打开，核对正文/方向/标签/位置；勾选一个含长代码块的章节，标题滚出视野后确认正文仍为已读，再回到顶部确认勾选不闪回。升级覆盖原目录，重载扩展后刷新所有 ChatGPT 标签页，避免新旧脚本混用。

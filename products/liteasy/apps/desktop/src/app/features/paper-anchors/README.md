# 论文锚点实体

`liteasy.paper-anchor/v1` 把证据身份、论文来源、定位器、原文快照和固定呈现放在同一记录中。`presentation.kind = paper-citation`、`placement = after-content` 表示引用原文卡片跟随正文呈现；论文标题和页码是显示属性，不能替代证据身份。

多论文检索在生成 `AnalysisEvidence` 时保存 `paperAnchor`，对应 `Citation` 与薄读 evidence span 携带同一实体。实体沿用已有 evidence ID 和 analysis/chunk 来源记录；不按标题或内容哈希合并不同证据，也不建立第二份论文正文仓库。历史产物通过只读 adapter 呈现，读取不会迁移存储。

保存回答摘录或产物页面时，`ObjectEnvelope.paperAnchors` 携带这些实体；来源消息、派生笔记和副本沿用相同引用。薄读批注进入 Notes 时读取原节点实体。`ContextSnapshot.entries[].paperAnchors` 固定对应对象 revision 中的实体，模型提示只追加 ID、论文标题、页码映射，并将它计入上下文预算；新产物用顶层 `paperAnchors` 保存原引用，避免对象来源的 PPT 因没有 AnalysisEvidence 而丢失引用。实体元数据变化产生新对象 revision，不覆盖旧引用。

已有 `ObjectAnchor` 可通过 `paperAnchorFromObject` 适配，保留完整选择器、ObjectRef revision 与 document hash。只有页码的旧证据仍是页级定位；没有页码时保留原文、禁用跳转。未保存 source ObjectRef 或历史 PDF hash 的记录不声明已固定文档字节版本。

正文使用共享 `MarkdownContent` 并传入 `paperAnchors`。末尾的 remark 插件只改变显示文本，不移动领域插件用于句子定位的原始 offset，也不改写代码。已绑定的 `evidence-*` 显示论文标题和页码；缺失或冲突的绑定显示「来源待关联」，不猜测其论文、页码或引用顺序。旧 Citation 没有 evidence ID 时，以所属消息/产物的引用记录位置识别，不把内容相似当成 evidence ID 绑定。

正文下统一使用 `PaperAnchorReferences`；一次呈现 12 条，余下按需展开。打开操作经当前宿主的既有 PDF 阅读器回调执行，保留原 evidenceId、提取器和文本偏移，不产生任意路径或未经解析的 URI。Markdown/HTML/PDF 文本导出使用可读出处，原始产物 JSON 继续保留机器引用字段。

普通对象问答通过公开消息 metadata 保留所有原始实体，有页码的实体同时投影为 Citation。聊天在没有可跳转页码时仍呈现原文摘录，捕获回答时实体继续进入对象。结构化产物文件采用 `liteasy.authored-resource/v1`，`content` 与 `sources.paperAnchors/contextRefs` 同源读取；Markdown 逐页、逐节点显示可读出处并附原文索引，不要求模型把机器 ID 写入正文。

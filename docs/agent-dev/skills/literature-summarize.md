# literature-summarize

## 状态

占位设计，尚未接入正式 skill registry。

## 目标

基于当前选中文献集生成结构化摘要，帮助用户快速理解论文的问题、方法、实验、结论和局限。

## 触发场景

- 用户要求“总结这篇论文”“概括选中文献”“提炼核心贡献”。
- 用户处于问答或解释模式，并且选中文献集已导入。

## 输入

- selected_document_set
- imported_chunks
- output_mode
- user_question

## 输出

- summary
- key_contributions
- method_outline
- limitations
- citations

## 安全边界

- 只能读取已导入的选中文献片段。
- 不访问任意本地文件。
- 不执行写操作。


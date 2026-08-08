# literature-compare

## 状态

占位设计，尚未接入正式 skill registry。

## 目标

比较多篇文献在研究问题、方法、数据集、指标、结论和适用边界上的异同。

## 触发场景

- 用户要求“对比这几篇论文”“找共同点和差异”“做 related work 表格”。
- 当前选中文献数大于等于 2。

## 输入

- selected_document_set
- imported_chunks
- comparison_dimensions

## 输出

- comparison_table
- shared_assumptions
- key_differences
- recommended_reading_order
- citations

## 安全边界

- 只比较当前选中文献。
- 不自动上传文献内容。
- 不把缺失信息编造成事实。


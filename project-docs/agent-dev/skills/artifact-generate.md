# artifact-generate

## 状态

占位设计，对应当前已有的 `artifact.generate` runtime action。

## 目标

把文献分析结果转换成 Liteasy 可展示的产物，例如脑图、知识卡片、表格、复习笔记或报告草稿。

## 触发场景

- 用户要求“生成脑图”“做成卡片”“输出表格”“生成复习笔记”。
- 选中文献集已导入，或者已有可用的分析结果。

## 输入

- artifact_type
- selected_document_set
- analysis_context

## 输出

- artifact_request
- ui_dsl
- audit_trace

## 安全边界

- 只能调用已注册的产物生成 action。
- 不直接修改原始 PDF。
- 涉及组织资料写入时需要确认。


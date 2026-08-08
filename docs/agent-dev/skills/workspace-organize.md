# workspace-organize

## 状态

占位设计，对应布局、面板、dock 和主题相关 runtime actions。

## 目标

根据用户意图调整 Liteasy 工作台布局，让阅读、问答、产物和组织资料区处在合适位置。

## 触发场景

- 用户要求“把助手放到底部”“打开组织资料区”“切成阅读布局”“恢复默认布局”。
- 用户表达的是界面组织意图，而不是文献内容问题。

## 输入

- layout_intent
- target_panel
- dock_item
- target_region

## 输出

- ordered_runtime_actions
- confirmation_request_when_needed
- ui_feedback

## 安全边界

- 只调用注册过的 UI action。
- 不直接操作 DOM。
- 不执行任意脚本或 CSS 注入。


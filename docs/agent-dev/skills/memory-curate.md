# memory-curate

## 状态

占位设计，尚未接入持久化 memory store。

## 目标

从用户长期行为中提取可复用偏好、研究画像、项目事实和经历记忆，并允许用户审查和删除。

## 触发场景

- 用户明确说“记住……”“以后都……”。
- 系统在对话结束后发现稳定偏好或项目事实。

## 输入

- conversation_excerpt
- candidate_memory
- namespace
- memory_type

## 输出

- memory_entry
- rejection_reason
- audit_record

## 安全边界

- 写入前扫描提示词注入和越权指令。
- 不保存密钥、token、隐私文件内容。
- 必须按 namespace 隔离。


# settings-adjust

## 状态

占位设计，对应当前已有的 `settings.adjust` skill 和 `settings.update` action。

## 目标

处理低风险设置变更，例如回答语言、默认输出模式、联网推荐排序等。

## 触发场景

- 用户要求“关闭联网推荐”“默认用中文回答”“推荐按时间排序”。
- 目标设置项存在于 settings registry。

## 输入

- setting_key
- setting_value
- user_intent

## 输出

- update_setting_command
- result_message

## 安全边界

- 只能修改白名单设置项。
- 高风险策略、模型密钥、API endpoint 不通过自然语言静默修改。
- 修改后必须给出明确反馈。


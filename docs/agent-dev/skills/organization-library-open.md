# organization-library-open

## 状态

占位设计，对应当前已有的 `organization.open_shared_library` runtime action。

## 目标

在用户授权和组织上下文可用时，打开组织共享资料区，并把组织资料作为受控上下文来源。

## 触发场景

- 用户要求“打开组织资料区”“去团队资料库”“查看共享文献”。
- 云账号已连接，并且组织资料 manifest 可用。

## 输入

- organization_context
- account_session
- shared_library_manifest

## 输出

- open_shared_library_action
- fallback_message

## 安全边界

- 未登录、无组织或 manifest 为空时必须拒绝或澄清。
- 不跨组织读取资料。
- 不把组织资料发送到未声明的外部 API。


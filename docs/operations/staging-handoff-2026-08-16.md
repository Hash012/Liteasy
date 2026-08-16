# Staging 交接记录（2026-08-16）

本文记录 `server-staging-sync-20260812` 分支在 Liteasy `0.1.12` 交付后的可公开运维基线。密码、私钥、AccessKey、client secret 和下载签名密钥不属于本记录。

## 源码与 Windows 制品

- Liteasy `0.1.12` Windows x64 NSIS 安装包来自提交 `be7dd67ac84275d27b2e3fafe9db8ce0e0cdde9c`，对应标签 `v0.1.12-staging.1`。
- 文件名：`Liteasy_0.1.12_x64-setup.exe`。
- 大小：`16545637` 字节。
- SHA-256：`ca889267b3b77be0b86b5d1be668f40598012fed100f57aa3b3d4da38b19d8d1`。
- Authenticode：`NotSigned`。这只是在负责人批准下用于受控 staging 的例外，不能用于生产或不受控公开发布。
- 服务器制品和审计元数据位于 `/var/lib/liteasy/waitlist/releases/0.1.12/`，权限为 `root:root`、`0600`。
- waitlist 服务从 `/opt/liteasy/waitlist/.env` 读取当前版本；公开健康检查应返回 `{"ok":true,"installerReady":true}`。
- GitHub Actions 构建因账户计费限制未启动。本版本由可信 Windows 构建机生成，完成 `1988` 项桌面测试、生产构建、Cargo 检查、NSIS 构建、升级启动、重启、OAuth 回调、数据保留和退出生命周期验证后，再由服务器独立核对大小与 SHA-256 并原子发布。

## OAuth 配置对齐

提交 `b97db40` 将本地和 staging 模板中的桌面回调收窄为：

- `http://127.0.0.1/oauth/callback`
- `http://localhost/oauth/callback`

这与桌面 Rust 宿主的固定 `CALLBACK_PATH` 一致。交接时已确认 `/etc/liteasy/staging/keycloak.env` 和运行中 Keycloak 数据库的 `liteasy-desktop-public` 客户端均使用这两个精确 URI。

## 登录与 OTP 边界

- 普通桌面端 `liteasy-desktop-public` 和论坛 `intuecho-web` 使用 `liteasy-user-browser`，允许 SSO Cookie 或密码登录，不要求 OTP。
- 管理端 `liteasy-admin-public` 独立绑定 `liteasy-admin-browser`，该流程每次要求密码和 OTP，不复用普通客户端的无 OTP 认证流。
- `Configure OTP` 在 realm 中启用但不是全局默认 Required Action；只对 `platform_admin` 账号逐个分配。新建普通用户不得被要求配置 OTP。
- 邮箱验证与 OTP 是两个独立门禁：realm 继续启用邮箱验证，但完成邮箱验证不等于完成管理员 MFA。
- 2026-08-16 已在运行 realm 应用上述策略：桌面/论坛的 Conditional 2FA 为 `DISABLED`，管理 flow 的 Password/OTP 均为 `REQUIRED`，非管理员的 `Configure OTP` 待办为 `0`。4 个活跃平台管理员中 2 个已绑定 OTP，另 2 个保留首次配置动作；后两位需先通过普通登录完成 OTP 注册，再进入管理端。
- 变更前快照为 `/var/lib/liteasy-staging/releases/20260816T074208Z.keycloak-auth-policy.json`，SHA-256 为 `85b31426e85e135ce33334bad52718b84f9a6bc711c47015b24287600db81863`。变更后证据为 `/var/lib/liteasy-staging/releases/20260816T075654Z.keycloak-auth-policy-applied.json`，SHA-256 为 `1b1a58b0e189ae648fcaee78f1b74e1490301106cf9d91c340c0456d6e0a5076`；两者均为 `root:root`、`0600`。
- 为避免中断所有 staging 用户，本次没有执行 realm-wide logout。旧管理 access token 最长存活 `300` 秒；之后的新管理认证必须经过管理端 OTP flow。配置、OIDC discovery、Liteasy API readiness 和 waitlist health 已验证，仍需用真实普通账号和管理员账号分别完成一次交互式 E2E。

## 运行镜像基线

应用镜像均按 digest 固定。它们不强制共享同一个 Git revision；是否需要重建以对应服务源码差异为准。

| 服务 | 镜像 digest / ID | revision | 研判 |
| --- | --- | --- | --- |
| gateway | `sha256:72412085c1091162b1b6b465b26d7709fde07a289c958658b3ba740202098db3` | `714283f5` | 从该 revision 到交接分支没有 gateway/marketing 源码变化，不重建 |
| liteasy-api | `sha256:3b51f66e086bc53f44e8bf60f83d8d2581f32a2d881d97538e3cff585674f245` | `714283f5` | 从该 revision 到交接分支没有 Liteasy API 源码变化，不重建 |
| identity-management | `sha256:2f0c038d1a7b00180a2ec15947098ec2d7af36396e893f9e51dcb6b2da6b47e9` | `c0ebdd98d2fe7eaf170cc59decef5dd7c100f269` | 对应服务源码无变化，不重建 |
| intuecho-api | `sha256:01100948882bfc6cb35add02275d151f06994d4e7156d144e3fa8883108fb19c` | `eecc93ed9751873310a2af0afe7e9ca69ae20459` | 对应产品源码无变化，不重建 |
| Keycloak | `sha256:98fab020a3a490aba0978f237e2a06cd0ea42bf149c6cf10f11c0aaf27728ff2` | 上游 `26.3.2` | 外部上游组件，按 digest 固定，不与仓库 SHA 对齐 |
| PDF scanner adapter | `sha256:76de9766d683d4eb8534fc09921894237c45056a9efb5803a4a1426b182338ee` | 本地镜像 `1.0.0` | 本次无扫描器源码变更，不重建 |
| ClamAV / freshclam | `sha256:71ea3179446c23b64ceddcccd70cb1603b5655f80d611fd9fead7e34dc357c48` | 本地镜像 `1.5.4` | 独立安全依赖，本次无配置或版本变更，不重建 |

`714283f5` 之后到 `be7dd67` 的产品代码变更位于桌面应用；其余提交只更新部署 OAuth 默认值、断言和交接手册。因此为统一 revision 而重建 gateway、API、identity 或 Intuecho 不会引入新产品代码，只会产生无意义的新 digest 和部署风险。

## 交接验证

交接前已完成：

- staging 配置与手册契约测试：`17/17` 通过。
- local 配置测试：`2/2` 通过。
- local foundation 静态检查通过。
- 所有核心容器为 running，带健康检查的核心容器为 healthy。
- `liteasy-waitlist.service` 为 active。
- `https://staging.liteasyclaw.com/healthz/waitlist` 返回 `installerReady: true`。
- Liteasy API `/readyz` 返回 `status: "ready"`，其中 `modelProxy: "configured"`。这是薄读具名测试所需的受控能力，不代表允许匿名访问、公开推广或提高并发。

下一位维护者开始工作时先执行：

```bash
cd /opt/liteasy/repository
git fetch origin
git status --short
git rev-parse HEAD
git rev-parse origin/server-staging-sync-20260812
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
systemctl is-active liteasy-waitlist.service
curl -fsSL https://staging.liteasyclaw.com/healthz/waitlist
```

两个 Git SHA 应一致，`git status --short` 应无输出。不要为了让镜像 revision 文字相同而重建；先按服务路径比较源码差异，再决定受影响服务。

## 尚未对齐与停止点

- DeepSeek 文本供应商改造目前仅存在于未部署的工作树：薄读、AI 助手、翻译、Agent 和结构化可视化计划使用 `deepseek-chat`，图片生成继续使用 `gpt-image-2`，MinerU 图片理解继续使用 `gpt-5.6-sol`。在新 API/gateway 镜像和桌面制品发布、digest 更新、迁移 `032` 执行、root-only 出站主机名更新、管理员录入 DeepSeek Key 及五条调用链验收全部完成前，不得描述为 staging 已切换。
- Windows 构建目录可继续保留在安装包提交 `be7dd67`，用于重复制品证据；它不应伪装成部署分支最新 checkout。新开发工作应重新检出远程分支。
- `0.1.12` 未签名。生产或不受控公开发布必须获得受信任的 Authenticode 签名并完成干净 Windows 11 安装、升级和卸载 E2E。
- GitHub Actions 账户计费问题仍需由仓库/组织管理员处理。解决前不要降低 OIDC 上传校验，也不要向服务器保存长期 GitHub 凭据。
- 模型代理当前为受控 staging 测试启用状态；部署密钥必须继续保持 root-only。扩大账号、并发、供应商范围或公开访问前需要单独容量与安全评审。
- Keycloak、ClamAV 和各独立服务镜像按自身版本与 digest 管理，不与桌面发布 SHA 强制统一；升级必须单独完成兼容性、迁移、健康和回滚验证。

# Staging 交接记录（2026-08-16）

本文记录 `server-staging-sync-20260812` 分支在 Liteasy `0.1.11` 交付后的可公开运维基线。密码、私钥、AccessKey、client secret 和下载签名密钥不属于本记录。

## 源码与 Windows 制品

- Liteasy `0.1.11` Windows x64 NSIS 安装包来自提交 `dbdfa59723bb9a0619d92fbefc3e4f5b0b6df711`，对应标签 `v0.1.11-staging.1` 和 `v0.1.11-staging.2`。
- 文件名：`Liteasy_0.1.11_x64-setup.exe`。
- 大小：`16542411` 字节。
- SHA-256：`d3a115dbb4e0f412b0de01091319f5e965994c31f3e66db03970992925205564`。
- Authenticode：`NotSigned`。这只是在负责人批准下用于受控 staging 的例外，不能用于生产或不受控公开发布。
- 服务器制品和审计元数据位于 `/var/lib/liteasy/waitlist/releases/0.1.11/`，权限为 `root:root`、`0600`。
- waitlist 服务从 `/opt/liteasy/waitlist/.env` 读取当前版本；公开健康检查应返回 `{"ok":true,"installerReady":true}`。
- GitHub Actions 构建因账户计费限制未启动。本版本由可信 Windows 构建机生成，完成 `1985` 项桌面测试、生产构建、Cargo 检查和 NSIS 构建后，再由服务器独立核对大小与 SHA-256 并原子发布。

## OAuth 配置对齐

提交 `b97db40` 将本地和 staging 模板中的桌面回调收窄为：

- `http://127.0.0.1/oauth/callback`
- `http://localhost/oauth/callback`

这与桌面 Rust 宿主的固定 `CALLBACK_PATH` 一致。交接时已确认 `/etc/liteasy/staging/keycloak.env` 和运行中 Keycloak 数据库的 `liteasy-desktop-public` 客户端均使用这两个精确 URI。

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

`714283f5` 之后到 `dbdfa597` 的产品变更全部位于桌面应用；`b97db40` 只更新部署 OAuth 默认值、断言和交接手册。因此为统一 revision 而重建 gateway、API、identity 或 Intuecho 不会引入新产品代码，只会产生无意义的新 digest 和部署风险。

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

- Windows 构建目录可继续保留在安装包提交 `dbdfa597`，用于重复制品证据；它不应伪装成部署分支最新 checkout。新开发工作应重新检出远程分支。
- `0.1.11` 未签名。生产或不受控公开发布必须获得受信任的 Authenticode 签名并完成干净 Windows 11 安装、升级和卸载 E2E。
- GitHub Actions 账户计费问题仍需由仓库/组织管理员处理。解决前不要降低 OIDC 上传校验，也不要向服务器保存长期 GitHub 凭据。
- 模型代理当前为受控 staging 测试启用状态；部署密钥必须继续保持 root-only。扩大账号、并发、供应商范围或公开访问前需要单独容量与安全评审。
- Keycloak、ClamAV 和各独立服务镜像按自身版本与 digest 管理，不与桌面发布 SHA 强制统一；升级必须单独完成兼容性、迁移、健康和回滚验证。

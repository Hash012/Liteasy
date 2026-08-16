# Liteasy 开发、镜像部署与 Windows 发布操作指南

本文面向接手 Liteasy 的开发者，规定从源码修改、远程同步、容器镜像构建、staging 部署，到 Windows 安装包构建与上线的完整流程。目标不是让所有版本号“看起来一致”，而是让每个运行产物都能追溯、验证、回滚，并且不泄露秘密。

> 当前交付路径已固定为：可信 Windows x64 电脑本地构建和实机验收，开发者通过阿里云 Workbench 手工上传到服务器 `/tmp`，服务器再独立核验并原子发布。GitHub Actions 因额度不足不可用，Windows 到服务器的 SSH 也已确认不通；本次不得重试或绕过这两个条件。Codex 分阶段提示词和 Workbench 操作见 [`codex-assisted-release-and-deployment-guide.md`](./codex-assisted-release-and-deployment-guide.md)。

本文是日常发布入口。首次搭建云资源、完整安全门禁、存储恢复演练等细节以以下文档为准：

- [`deployment/staging/README.md`](../deployment/staging/README.md)：staging 首次部署、镜像、迁移、验收和回滚的权威手册。
- [`docs/operations/staging-handoff-2026-08-16.md`](../docs/operations/staging-handoff-2026-08-16.md)：当前 staging 基线和已知停止点。
- [`docs/operations/Liteasy-存储备份与恢复运行手册.md`](../docs/operations/Liteasy-存储备份与恢复运行手册.md)：数据库和对象存储恢复要求。
- [`docs/operations/Liteasy-后续部署与验收执行计划.md`](../docs/operations/Liteasy-后续部署与验收执行计划.md)：更广泛的上线证据要求。
- [`.github/workflows/windows-installer.yml`](../.github/workflows/windows-installer.yml)：Windows CI 构建和 OIDC 发布实现。

## 1. 适用范围和角色

本流程覆盖受控 staging。生产环境必须使用独立域名、计算资源、数据库、bucket、secret 和配置目录，不能把 staging 主机原地改名为生产。

| 位置/角色 | 负责内容 | 不应执行 |
| --- | --- | --- |
| 开发者本地机 | 日常开发、受影响测试、提交和推送 | 直接修改服务器运行配置；持有无关生产秘密 |
| 仓库服务器 `/opt/liteasy/repository` | 必要的线上诊断或小范围迭代、检出待部署 SHA、Compose 部署 | 在 2 vCPU/4 GiB ECS 构建依赖密集镜像；把运行配置提交到 Git |
| 受控 Linux/CI 镜像构建机 | 测试、构建镜像、推送 ACR、记录 digest | 使用脏工作树构建；推送 `latest` 后直接部署 |
| 可信 Windows x64 构建机 | 桌面全量测试、Tauri/NSIS 构建、实机验收 | 测试前注入 release URL；验证完成前上传安装包 |
| 发布操作者 | 备份、发布、健康检查、回滚和审计记录 | 猜测 SSH 账号；覆盖已有版本目录；泄露 secret |

多人协作时应明确指定：变更负责人、评审人、镜像构建人、Windows 构建人、部署人和值班人。一个人可兼任，但每个阶段的证据不可省略。

## 2. 不可妥协的原则

1. **先识别，后改变。** 每次操作先记录目标环境、分支、完整 Git SHA 和 `git status --short`。未知改动属于别人，不能删除、覆盖或自动清理。
2. **提交、镜像和安装包分别追溯。** 仓库 HEAD、各服务镜像 revision、Windows 安装包源提交、Keycloak/ClamAV 上游版本不要求相同；它们必须各自有准确记录。
3. **按影响范围重建。** 只有对应服务源码、构建上下文或部署配置改变时才重建该镜像。不得为了统一 revision 标签制造新 digest。
4. **部署只认 digest。** `deployment/staging/config.env` 中应用镜像必须是 `<registry>/<image>@sha256:<digest>`，禁止 `latest` 和只有 tag 的引用。
5. **测试环境与发布环境变量隔离。** Windows 测试阶段清除三个 `VITE_*` URL；测试通过后才为生产资源和 NSIS 构建设置 staging URL。
6. **构建失败立即停止。** 不从旧 `target/`、旧 `artifacts/` 或上一次成功输出中挑文件继续发布。
7. **迁移前先备份。** 已应用新迁移时不能直接切回旧镜像；优先前向修复，必要时按恢复手册进行隔离恢复。
8. **制品不可变。** 同一版本目录和文件一经发布不得覆盖；内容变化必须提升版本。
9. **秘密不进入命令记录。** 密码、token、AccessKey、client secret、私钥不进入 Git、聊天、截图、发布记录或 Shell history。登录命令使用交互输入或批准的秘密系统。
10. **未签名只限明确批准的 staging。** `NotSigned` 不是生产可交付状态，也不能自动沿用到下个版本。

## 3. 四条身份链

一次交付至少记录以下身份，不要用单一“最新版”代替：

| 身份 | 示例 | 用途 |
| --- | --- | --- |
| 源码身份 | 完整 40 位 Git SHA、分支、远程仓库 | 复现变更和测试 |
| 镜像身份 | ACR 仓库加 `@sha256:...` | 精确部署某个容器内容 |
| 桌面制品身份 | 版本、源 Git SHA、文件名、字节数、SHA-256、签名状态 | 复现和核验安装包 |
| 运行身份 | Compose 配置快照、运行镜像、迁移结果、配置变更单 | 说明服务器实际运行什么 |

例如只修改桌面应用时，可以发布来自新 Git SHA 的 `0.1.13` 安装包，而服务器 API 镜像继续使用旧 digest。这是合理状态，但必须在交接记录中说明“服务路径无变化，因此未重建”。Keycloak、ClamAV 等上游组件按自身版本和安全节奏升级。

## 4. 开始前建立发布记录

为每次迭代建立不含秘密的记录，至少包含：

```text
release_scope:
operator:
reviewer:
started_at_utc:
source_repository:
source_branch:
source_git_sha:
changed_paths:
tests:
images_built:
image_digests:
database_backup_id:
migration_outputs:
desktop_version:
installer_source_sha:
installer_file_name:
installer_size:
installer_sha256:
authenticode_status:
windows_validation:
deployment_started_at_utc:
deployment_finished_at_utc:
health_checks:
rollback_reference:
known_warnings:
approvals:
```

时间统一使用 UTC ISO 8601。警告与失败不得只写“已处理”，应记录实际原因、复跑命令和结果。

## 5. 源码迭代与远程同步

### 5.1 优先在开发者本地机修改

不同开发者的目录可以不同。下文统一用 `<repo>` 表示仓库根目录；不要硬编码其他人的路径。

```bash
cd <repo>
git fetch --prune origin
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/<target-branch>
```

如果 `git status --short` 有不认识的输出，停止并联系改动所有者。不要运行 `git reset --hard`、`git checkout -- .`、`git clean -fd` 或删除未知文件。

从目标分支创建聚焦分支，修改后先运行受影响测试，再按影响面扩大测试。常用门禁见仓库根目录 [`AGENTS.md`](../AGENTS.md)。例如：

```bash
(cd products/liteasy/services/api && npm test)
(cd products/intuecho && npm test && npm run build)
(cd platform/identity-service && npm test)
(cd products/liteasy/apps/desktop && npm test && npm run build)
node --test deployment/staging/verify-config.test.mjs deployment/staging/templates.test.mjs
```

只运行与变更相关的命令；但共享契约、部署模板、认证、迁移或发布边界改变时，要同时验证所有下游消费者。

提交应聚焦且可评审：

```bash
git diff --check
git diff --stat
git status --short
git add <明确文件列表>
git diff --cached --check
git diff --cached
git commit -m "<type>: <imperative summary>"
git push origin HEAD:<target-branch>
```

不要使用 `git add .` 掩盖不相关文件。推送后验证远程确实收到相同 SHA：

```bash
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git ls-remote origin refs/heads/<target-branch> | awk '{print $1}')"
test "$local_sha" = "$remote_sha"
```

最后记录完整 SHA、测试结果和评审链接。合并后的部署候选必须重新以远程提交为准，不能继续用合并前的本地 SHA。

### 5.2 必须在服务器仓库修改时

服务器上的仓库也是运行部署入口，风险高于普通开发机。只处理已授权的小范围修复：

```bash
cd /opt/liteasy/repository
git fetch --prune origin
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/<target-branch>
```

满足以下条件才开始编辑：当前目录正确、工作树干净或所有已有改动归属清楚、目标分支明确、已有回退 SHA。编辑和测试后按 5.1 节提交并推送。推送不会自动改变正在运行的容器；必须另走镜像与部署流程。

交接前再次确认：

```bash
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/<target-branch>
```

除被 `.gitignore` 明确排除的 root-only 运行配置外，服务器工作树应保持干净。不要把 `/etc/liteasy/staging/*.env`、`deployment/staging/config.env` 或任何秘密强制加入 Git。

## 6. 判断需要重建哪些镜像

先确定每个当前镜像记录的源 SHA，再对该 SHA 到候选 SHA 做路径比较：

```bash
git diff --name-only <service-current-sha>..<candidate-sha>
git diff --stat <service-current-sha>..<candidate-sha> -- <relevant-paths>
```

| 变化路径 | 通常受影响产物 |
| --- | --- |
| `products/liteasy/services/api/`、`products/liteasy/packages/shared/`、对应 Dockerfile/lockfile | `liteasy-api` |
| `products/intuecho/services/api/` 及其共享契约、依赖和 Dockerfile | `intuecho-api` |
| `platform/identity-service/` | `identity-management` |
| `products/marketing/`、论坛/管理前端构建输入、`deployment/staging/Caddyfile`、`deployment/staging/gateway.Dockerfile` | `staging-gateway` |
| `deployment/staging/compose.yaml` 或配置模板 | 先评审运行配置；不一定需要新应用镜像 |
| `products/liteasy/apps/desktop/` | Windows 安装包；通常不需要服务器镜像 |
| 数据库 migration | 对应 API 镜像、备份和迁移流程 |
| 仅文档/测试且不进入镜像上下文 | 通常不重建 |

如果共享 lockfile、基础镜像、构建参数或 Docker build context 改变，也视为镜像变化。Keycloak 和 ClamAV 不跟随仓库 HEAD 重建；升级它们必须单独评审版本、digest、兼容性、资源和回滚。

把结论写成逐项记录，例如：

```text
liteasy-api: rebuild; API source changed
intuecho-api: no rebuild; relevant path diff is empty
identity-management: no rebuild; relevant path diff is empty
staging-gateway: rebuild; Caddyfile changed
windows-installer: rebuild; desktop source/version changed
```

## 7. 在受控构建机构建并推送镜像

不要在 2 vCPU/4 GiB staging ECS 上执行依赖安装和 Docker build。受控 Linux 构建机或 CI 必须检出已评审的完整 SHA，且工作树为空：

```bash
git fetch --prune origin
git checkout --detach <candidate-sha>
git rev-parse HEAD
git status --short
```

针对受影响组件运行测试。全套 staging 镜像门禁和精确 build 命令见 [`deployment/staging/README.md`](../deployment/staging/README.md#92-在-ci-或受控构建机上构建)。原则如下：

1. 依赖安装使用 lockfile，例如 `npm ci`，不使用 `npm install` 改写依赖树。
2. 任一测试或前端构建失败即停止。
3. 镜像 tag 使用完整 `<git-sha>`，并设置 `SOURCE_REVISION`。
4. Liteasy API 的 build context 必须是 `products/liteasy`，以包含共享可视化 schema。
5. gateway 的 staging URL 和 Caddy 基础镜像 digest 必须显式提供。
6. 构建后验证 Liteasy API 模块导入和 Caddy 配置，再推送。

ACR 登录应让 Docker 交互询问密码：

```bash
docker login --username=<ACR-user> registry.cn-hongkong.aliyuncs.com
```

只推送本次实际重建并通过验证的镜像：

```bash
docker push <acr>/<image>:<candidate-sha>
docker inspect --format '{{join .RepoDigests "\n"}}' <acr>/<image>:<candidate-sha>
```

与 ACR 控制台交叉核对完整 `@sha256:...`，记录构建机、时间、源 SHA、测试和 digest。仅 tag 存在但没有 registry digest 不算推送完成。

## 8. 在服务器部署镜像和代码

### 8.1 部署前快照

开始前确认发布窗口、值班人、回滚人和健康基线。先保存当前可回退信息：

```bash
cd /opt/liteasy/repository
git status --short
release_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -o root -g root -m 0700 /var/lib/liteasy-staging/releases
sudo install -o root -g root -m 0600 \
  deployment/staging/config.env \
  "/var/lib/liteasy-staging/releases/${release_stamp}.config.env"
git rev-parse HEAD | sudo tee \
  "/var/lib/liteasy-staging/releases/${release_stamp}.git-sha" >/dev/null
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  images --format json | sudo tee \
  "/var/lib/liteasy-staging/releases/${release_stamp}.images.json" >/dev/null
```

确认三个文件存在，再检出经过评审的候选 SHA：

```bash
git fetch --prune origin
git cat-file -e <candidate-sha>^{commit}
git checkout --detach <candidate-sha>
git rev-parse HEAD
git status --short
```

`HEAD` 必须精确等于候选 SHA，状态必须无输出。更新 `deployment/staging/config.env` 中**受影响镜像**的 digest；未受影响镜像保留原 digest。除非发布单明确包含配置/secret 轮换，不改 `/etc/liteasy/staging/*.env`。

### 8.2 配置、备份、迁移和启动

所有 Compose 命令都必须同时指定 env 和 compose 文件：

```bash
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  config --quiet
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  pull
```

不要运行缺少 `--env-file` 的 plain `docker compose`，否则会产生误导性的缺变量错误。

如果 API、migration、数据库契约或对象存储行为有变化：

1. 在 RDS 控制台创建手工备份并等待成功，记录任务 ID 和时间点。
2. 按 staging 手册运行 OSS 兼容性探针。
3. 用独立 migrator 账号运行 Liteasy/Intuecho 迁移。
4. 原样复跑迁移，必须得到 `{"applied":[]}`。
5. 出现 checksum、未知 migration、权限或非零退出码立即停止。

迁移命令：

```bash
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  --profile migration run --rm liteasy-migrate
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  --profile migration run --rm intuecho-migrate
```

启动并检查：

```bash
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  up --detach --remove-orphans
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  ps
```

绝不执行 `docker compose down --volumes`，也不删除 Caddy data volume。

### 8.3 上线后验证

至少验证：

```bash
curl -fsSL https://api.staging.liteasyclaw.com/readyz
curl -fsSL https://staging.liteasyclaw.com/healthz/waitlist
systemctl is-active liteasy-waitlist.service
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  ps
```

`api.staging.../` 根路径返回 `404` 可以是正常行为，应以 `/readyz` 判断 API。`identity.staging.../readyz` 对公网返回 `404` 是有意隐藏，不能据此判定 identity 服务失败。

此外从外网和真实测试账号验证：TLS、登录/OAuth、论坛、管理端授权、桌面关键 API、文件上传/扫描（若受影响）、维护 timer 和告警。不得只看容器为 `running` 就宣布成功。

## 9. Windows 本地构建的统一前提

开发者可以在 Linux、macOS 或 Windows 上进行源码编辑和受影响测试，仓库路径也可以不同。跨平台开发时只提交源码和 lockfile，不提交 `node_modules/`、`target/`、平台缓存或个人 IDE 配置。涉及文件名大小写、路径分隔符、Shell 脚本、Tauri/Rust 宿主或本地文件系统边界的变更，必须补做目标平台验证。

| 本地平台 | 可以承担 | 不能替代 |
| --- | --- | --- |
| Linux | 服务、前端、部署脚本和容器镜像测试/构建 | Windows NSIS 与 Authenticode E2E |
| macOS | TypeScript/React 开发和与平台无关的测试 | Windows MSVC、NSIS 和 WebView2 验收 |
| Windows x64 | 桌面开发、MSVC Rust、NSIS 构建和 Windows 实机验收 | Linux 容器运行态和 ECS 网络验收 |

因此，“在某位开发者电脑测试通过”不自动代表发布门禁通过。正式 Windows 安装包必须在可信 Windows x64 构建机上生成，并满足相同可复现条件：

- Windows 10/11 x64；可信、已更新且无可疑构建工具。
- Node.js 22 与 npm lockfile 工作流。
- Rust stable，host 为 `x86_64-pc-windows-msvc`。
- Visual Studio 2022 Build Tools，安装“Desktop development with C++”、MSVC v143 和 Windows SDK。
- Microsoft Edge WebView2 Runtime。
- 足够磁盘空间；不从不明镜像站下载整合环境。

`x86_64-pc-windows-msvc` 表示为 64 位 Windows、Microsoft MSVC ABI 构建。它是工具链目标，不是服务器地址，也不是需要写入源码的配置。检查：

```powershell
node --version
npm --version
rustc --version --verbose
cargo --version
rustup show active-toolchain
```

`rustc --version --verbose` 的 `host` 必须是 `x86_64-pc-windows-msvc`。不是时停止并安装正确工具链；不要用 GNU 产物冒充 MSVC 交付件。

建议为每次发布使用新的明确目录，例如 `D:\packing\liteasy-<version>`。旧 `artifacts/` 可以留作证据，但不能混入本次候选文件。

## 10. Windows 安装包构建

### 10.1 固定提交和版本

在 PowerShell 中：

```powershell
Set-Location <repo>
git fetch --prune origin
git checkout --detach <installer-source-sha>
git rev-parse HEAD
git status --short
```

完整 SHA 必须匹配发布单，tracked 状态必须干净。确认版本在以下三处一致：

- `products/liteasy/apps/desktop/package.json`
- `products/liteasy/apps/desktop/src-tauri/tauri.conf.json`
- `products/liteasy/apps/desktop/src-tauri/Cargo.toml`

版本不一致时修源码、提交、重新评审，不在构建目录临时改完后继续。

### 10.2 安装依赖和测试，禁止注入 release URL

```powershell
Set-Location products/liteasy/apps/desktop
npm config get registry
npm ci --registry=https://registry.npmjs.org/

Remove-Item Env:VITE_LITEASY_CLOUD_URL -ErrorAction SilentlyContinue
Remove-Item Env:VITE_FORUM_API_URL -ErrorAction SilentlyContinue
Remove-Item Env:VITE_FORUM_WEB_URL -ErrorAction SilentlyContinue
Remove-Item Env:CI -ErrorAction SilentlyContinue

npm test -- --testTimeout=120000
```

这里清除 URL 是强制要求。曾经把 staging URL 注入完整测试，导致测试预期的 `http://127.0.0.1:8787` 被覆盖，并触发控制面策略校验，产生 6 个并非产品回归的失败。

测试偶发超时时，允许在**不修改源码且环境相同**的前提下先单独重跑失败测试，再重跑完整测试。只有完整测试最终全绿才能继续；不要只凭单测复跑通过发布。记录 passed/failed/skipped 和耗时。React `act(...)`、依赖弃用、audit 漏洞等警告要记录并另行治理，不在发布窗口直接运行 `npm audit fix`。

### 10.3 构建阶段才设置 staging URL

```powershell
$env:CI = "true"
$env:VITE_LITEASY_CLOUD_URL = "https://api.staging.liteasyclaw.com"
$env:VITE_FORUM_API_URL = "https://community.staging.liteasyclaw.com"
$env:VITE_FORUM_WEB_URL = "https://community.staging.liteasyclaw.com"

npm run build
cargo check --manifest-path src-tauri\Cargo.toml
npm run tauri -- build --bundles nsis
```

生产资源验证器必须在缺少任一构建 URL 时以 `production_asset_boundary` 失败。不要绕过该门禁。`0.1.11` 手工构建漏注入 URL 后出现启动白屏，`0.1.12` 已通过分离测试变量与构建变量修复流程。

NSIS 目录中本次应只有一个候选：

```powershell
$installers = @(Get-ChildItem .\src-tauri\target\release\bundle\nsis\*-setup.exe)
if ($installers.Count -ne 1) {
  throw "Expected exactly one NSIS installer, found $($installers.Count)."
}
$installer = $installers[0]
$installer | Format-List FullName,Length,LastWriteTime
```

复制到独立交付目录，规范命名为 `Liteasy_<version>_x64-setup.exe`。复制后比较源文件与交付文件哈希；不要覆盖已有同版本制品。

### 10.4 签名、哈希和实机验证

先检查 Authenticode：

```powershell
Get-AuthenticodeSignature $installer.FullName |
  Format-List Status,StatusMessage,SignerCertificate,TimeStamperCertificate
```

生产必须使用受信任 Authenticode 和 RFC 3161 时间戳，最终状态为 `Valid`。私钥只能在批准的硬件令牌、HSM 或云签名服务中使用。staging 若批准未签名例外，状态必须恰为 `NotSigned`；`HashMismatch`、`NotTrusted` 等不能当作未签名。

签名完成后再生成最终 SHA-256 和大小：

```powershell
$hash = (Get-FileHash -Algorithm SHA256 $installer.FullName).Hash.ToLowerInvariant()
$size = (Get-Item $installer.FullName).Length
$hash
$size
```

在干净 Windows 11 x64 虚拟机或代表性实机验证：

1. 安装/升级退出码为 `0`，FileVersion、ProductVersion、架构正确。
2. 首次启动和再次启动均完整显示，无白屏。
3. 系统浏览器 OAuth 能进入 staging 身份服务并回调客户端。
4. staging API、论坛和身份配置端点可达；API 根路径 `404` 不当作失败。
5. 原有本地文献库和索引仍存在，无用户内容丢失。
6. 关键阅读、文献和网络路径通过；未登录限制符合设计。
7. 正常关闭窗口后主进程在合理时间内退出；区分托盘设计和进程泄漏。
8. 有签名版本验证发布者与时间戳；未签名 staging 记录 Windows 警告。
9. 按发布范围验证卸载，确认不会误删用户文献。

任一项失败都停止上传。保存 Windows build、工具链版本、完整 Git SHA、测试结果、文件名、大小、SHA-256、签名状态和实机结果。

## 11. 发布 Windows 安装包

### 11.1 未来路径：GitHub Actions + OIDC（当前禁用）

当账户额度、账单和发布策略经过管理员确认恢复后，才可重新评审使用 [Windows installer workflow](../.github/workflows/windows-installer.yml)。当前 workflow 不会启动，本次发布不得触发、重试、换账号或降低 OIDC 校验。
恢复 Actions 属于未来独立的基础设施任务，不属于本次交付；即使本次手工发布遇到问题，也不能临时切回该路径。

### 11.2 当前路径：可信 Windows 构建 + Workbench 上传

当前 CI 不可用且 SSH 已确认不通。完成第 10 节所有门禁后，由开发者通过阿里云 Workbench 上传到：

```text
/tmp/Liteasy_<version>_x64-setup.exe
```

不要上传到 `/var/lib/liteasy`，不要在聊天中传密码/私钥。本次不检查、不调整也不重试 SSH；只使用已确认可进入目标 ECS 的阿里云 Workbench。

上传后 Windows 构建人提供期望字节数和 SHA-256，服务器发布人必须独立核验：

```bash
stat --format='%n %s bytes' /tmp/Liteasy_<version>_x64-setup.exe
sha256sum /tmp/Liteasy_<version>_x64-setup.exe
file /tmp/Liteasy_<version>_x64-setup.exe
```

任何不一致都停止，把错误上传移入 root-only 隔离位置并记录原因，不进入发布目录；是否删除由制品所有者确认。

## 12. 服务器原子发布安装包

以下过程应由 root 发布脚本或经过双人复核的运维步骤执行。发布目标是不可变目录：

```text
/var/lib/liteasy/waitlist/releases/<version>/Liteasy_<version>_x64-setup.exe
```

发布前确认目标目录和文件均不存在；存在则停止并提升版本，禁止覆盖。发布记录 JSON 至少包含：

```json
{
  "fileName": "Liteasy_<version>_x64-setup.exe",
  "gitSha": "<installer-source-sha>",
  "publishedAt": "<UTC ISO-8601>",
  "repository": "<owner/repository>",
  "sha256": "<lowercase-sha256>",
  "size": 0,
  "signed": false,
  "version": "<version>",
  "releaseMethod": "manual-workbench-fallback",
  "sourceTag": "<immutable-tag>",
  "windowsValidation": "<evidence reference>"
}
```

上例表示未签名 staging 手工发布；签名验证为 `Valid` 时必须把 `signed` 记录为布尔值 `true`，并补充签名者证书指纹和时间戳证据引用。不能把字符串 `"true"`/`"false"` 当作布尔值。

制品和元数据最终权限为 `root:root`、`0600`。先在同一文件系统的临时目录准备并复核，再原子 `mv` 到版本目录。不要在聊天中临时拼接未经评审的 root 命令；优先复用现有发布服务/脚本。

切换 waitlist 当前版本时：

1. 备份当前 root-only waitlist 配置。
2. 用临时副本只修改版本、文件、大小和 SHA-256 等非秘密字段。
3. 校验临时配置后原子替换。
4. 重启 `liteasy-waitlist.service`。
5. 在有限重试窗口内检查本地服务和公网 health。
6. 激活失败则立即原子恢复旧配置、重启并复核旧版本 health。

成功标准：

```bash
systemctl is-active liteasy-waitlist.service
curl -fsSL https://staging.liteasyclaw.com/healthz/waitlist
```

公网结果必须包含 `{"ok":true,"installerReady":true}`。再通过真实短时下载令牌从外部下载一次，核对最终文件大小和 SHA-256。成功后才能清理 `/tmp` 上传副本；不可变发布目录和审计 JSON 保留。

## 13. 回滚

### 13.1 容器应用回滚

先查看本次两个迁移输出：

- 首次运行就是 `{"applied":[]}`：可以按 staging 手册恢复上一份 config snapshot、上一 Git SHA 和旧 digest，再 `pull`、`up`、完整验收。
- 任一迁移实际应用了文件：禁止直接启动旧镜像。优先发布兼容新 schema 的前向修复；必须恢复时按恢复手册从迁移前备份恢复到隔离 RDS，再验证数据库、迁移集合、权限和对象存储一致性后切换。

不得删除 `schema_migrations` 记录、修改已应用 SQL checksum、原地覆盖 RDS 或只恢复多服务数据的一部分。

### 13.2 安装包回滚

安装包回滚是把 waitlist 的“当前版本”原子切回一个已存在、已核验的不可变版本目录，不是覆盖新版本文件。恢复旧配置、重启服务、验证 `installerReady`，并从外部重新下载核验。已下载/安装的新客户端是否需要公告或前向修复，要单独评估客户端兼容性和用户数据。

## 14. 强制停止条件

出现任一情况立即停止，不得凭经验跳过：

- 工作树有归属不明的改动，或本地/远程 SHA 无法确认。
- 测试、生产资源验证、Cargo check、镜像导入、Caddy validate 或 NSIS 任一失败。
- 构建输入不是干净、已评审的完整 Git SHA。
- 镜像只有 tag、缺少 digest，或 ACR digest 与记录不一致。
- Compose 配置校验失败，或需要的 root-only 配置/secret 缺失。
- RDS 备份未成功，migration checksum/权限/幂等检查失败。
- 核心容器反复重启、readiness 连续失败、OOM、资源越线或扫描器故障关闭。
- 安装包版本不一致、候选不唯一、大小/哈希/签名状态不符。
- Windows 出现白屏、OAuth 回调失败、用户数据丢失或进程生命周期异常。
- 目标 release 目录已存在，或上传来源/主机密钥无法核验。
- 生产候选未获有效 Authenticode 签名或完整干净机 E2E。

## 15. 常见问题与已验证处理

### 测试预期 localhost，却收到 staging URL

原因是测试阶段继承了 `VITE_*` 构建变量。清除三个变量，重跑完整测试；只在 `npm run build`、Cargo/Tauri 构建阶段设置它们。不要修改测试预期为 staging。

### 完整测试偶发超时，但单独测试通过

先确认是耗时而非断言差异。在不改源码的前提下单独重跑失败文件，再用足够但有限的 timeout 重跑完整测试。只有完整结果全绿才能继续。记录 React `act(...)` 警告，但不要把警告误报为通过证明。

### `npm ci` 从镜像源得到 404

只为本次命令显式使用官方 registry，保持 `package.json`、lockfile 和 `.npmrc` 不变。若出现 `EPERM`，确认没有 Node、编辑器或杀毒软件锁定 `node_modules`，再处理目录；不要转用 `npm install`。

### 安装后白屏

首先核对生产构建是否注入三个 staging URL，以及 `npm run build` 的生产资源门禁是否实际运行。不要先归因于 WebView2 或用户机器。修复后提升版本、重新构建、实机验证，不能覆盖原安装包。

### GitHub Actions 没有额度

这是本次已确认的账户层阻塞，不是构建失败。本次直接执行可信 Windows 本地构建和 Workbench 手工上传，不触发 workflow、不换账号，也不削弱仓库权限或 OIDC 校验。

### SSH 已确认不通

本次不继续排查或重试 SSH，不尝试代理隧道、SCP/SFTP 或接受未知 host key。通过阿里云 Workbench 上传到 `/tmp`；SSH 恢复另开基础设施任务处理。

### API 根路径返回 404

这是预期可能行为；验证 `https://api.staging.liteasyclaw.com/readyz`。不要为了得到 200 而暴露内部端口或添加无意义根路由。

### 仓库 HEAD、镜像 revision 和安装包 SHA 不一致

先按第 3、6 节判断对应路径是否变化。不变则保留已验收 digest，并在记录中说明原因；变化才重建。追求视觉一致会增加无意义发布风险。

## 16. 交接清单

交接给下一位开发者时，提供以下**非敏感**信息：

- 远程仓库、目标分支、远程完整 SHA，服务器 checkout SHA 和 `git status --short`。
- 本次 changed paths、测试命令、通过/失败/跳过数量、已接受警告。
- 各服务是否重建、判断依据、完整 ACR digest 和构建证据。
- Compose 快照时间、RDS 备份 ID、两次迁移输出、运行容器与 health。
- 桌面版本、源 SHA、tag、文件名、字节数、SHA-256、Authenticode 和 Windows E2E。
- 安装包服务器不可变路径、发布方式、waitlist health 和外部下载核验。
- 所有未对齐项、明确原因、风险、负责人和下一步。
- 回滚 snapshot/版本引用和值班联系方式。

交接前在服务器执行只读基线检查：

```bash
cd /opt/liteasy/repository
git fetch origin
git status --short
git rev-parse HEAD
git rev-parse origin/<target-branch>
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  ps
systemctl is-active liteasy-waitlist.service
curl -fsSL https://staging.liteasyclaw.com/healthz/waitlist
```

“已上线”必须指明范围，例如 `controlled-10-user-staging`。在签名、容量、恢复和生产门禁没有证据前，不得写成“生产可用”或“公开发布完成”。

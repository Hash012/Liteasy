# 在 Codex 协助下完成 Liteasy 开发、构建与上线

本文是 [`developer-release-and-deployment-guide.md`](./developer-release-and-deployment-guide.md) 的 Codex 协作版本。前者定义技术事实、命令、门禁和回滚规则；本文定义当前服务器上的同一个 Codex 如何把源码检查、镜像构建、staging 部署和安装包发布拆成可授权阶段，以及只有 Windows 构建仍跨机器时如何交接可靠证据。

不要只把“帮我发布最新版”发给 Codex。这样的指令没有说明仓库、目标提交、环境、允许改变的外部状态和停止条件，容易把源码修改、镜像部署和安装包发布混成一次不可审计操作。

## 0. 宏观理解：
迭代与部署涉及到的对象关系：

  在 Liteasy 当前流程中（/opt/liteasy）
    ↓
  本地测试
  判断哪些组件需要重新构建
    ↓
  在当前服务器上由同一个 Codex 构建镜像
    ↓
  把镜像推送到阿里云 ACR，记录 digest
    ↓
  服务器更新镜像 digest，执行 compose pull/up
    ↓
  数据库迁移（如涉及）+ 健康检查 + 功能验收
    ↓
  部署成功

核心网站/API 跑 digest 镜像；/opt/liteasy/repository 不直接提供业务源码运行；
/opt/liteasy/waitlist 是直接运行宿主机代码的特殊服务，作用是：
  - 接收官网“加入体验计划”表单：POST /api/waitlist
  - 将申请写入 Liteasy API，并在服务器保存一份 JSONL 记录
  - 申请成功后签发短时下载链接
  - 提供 Windows 安装包下载：/downloads/liteasy-windows
  - 接收 GitHub Actions 通过 OIDC 上传的新安装包
  - 提供健康检查：/healthz/waitlist

  Caddy 会把这些公网请求转发给它，配置见 /opt/liteasy/repository/deployment/staging/Caddyfile:29。

  需要区分两个概念：

  - 当前受控 staging： 它是正式运行组件，体验申请和安装包下载都依赖它，不是模拟服务。
  - 未来生产环境： 当前仓库明确表示还没有达到公开生产发布标准。现有 waitlist 可以作为生产功能的基础，但当前未签名安装包、手工发布例外和 staging 配置不能直
    接照搬到生产，见 /opt/liteasy/repository/deployment/staging/README.md:1530。

  如果它停止：

  - Liteasy API、Intuecho、登录等核心容器不一定受影响；
  - 官网申请表会无法提交；
  - 用户无法通过申请后的短时链接下载安装包；
  - 自动上传新 Windows 安装包也会失败。

  所以准确定位是：它不是 Liteasy 核心业务后端，而是当前真实使用的官网获客、体验资格和安装包发布辅助服务。正式生产若仍采用“先申请、后下载”的模式，就仍然需要
  这类服务，但上线前应按生产标准重新部署和验收。


## 1. 基本协作模型

当前发布路径只有两个 Codex 角色，其中源码、镜像和服务器角色由同一个会话、同一台机器承担：

| 会话 | 建议位置 | 主要职责 |
| --- | --- | --- |
| 源码/镜像/服务器 Codex | 当前服务器 `/opt/liteasy/repository` | 检查、修改、测试、提交、推送、判断镜像影响、构建/推送受影响镜像、服务器部署 |
| Windows Codex | 可信 Windows x64，发布目录如 `D:\packing` | 固定 SHA、全量测试、MSVC/Tauri/NSIS 构建、实机验证、输出制品证据 |

源码、镜像和服务器阶段共享当前会话与文件系统，但仍必须按阶段停下并取得下一步授权；阶段边界不是把任务交给另一台 Linux 构建机。Windows Codex 不共享服务器状态，不要说“继续服务器上刚才那个版本”，应提供完整 Git SHA、版本、目标环境、已通过证据和允许执行的动作。

当前服务器是 2 vCPU、约 4 GiB 内存并启用 2 GiB swap 的 staging ECS。它确实是本流程的源码、镜像和部署机器，但镜像构建前必须检查可用内存、Docker daemon 和磁盘空间；资源不足、Docker 不可用或门禁失败时停止，不临时猜测或切换到不存在的构建机。构建只允许使用候选 SHA 的干净检出；不要在含有开发者未提交改动的工作树中构建。

这条同机路径是当前已确认的实际角色修正，覆盖通用手册中“构建机与 ECS 分开”的部署分工描述；它不放宽资源、干净 SHA、测试、签名、迁移或 digest 门禁。

### 1.1 第一次访问这台服务器（阿里云新手）

这里的“服务器”是阿里云 ECS，不是 GitHub，也不是 Liteasy 的网站登录页。你需要两套彼此独立的身份：阿里云账号或受邀的 RAM 子账号用于打开 ECS 控制台；Linux 账号和密码/SSH 密钥用于进入服务器终端。两者都不应发送给 Codex。没有阿里云权限时，请让资源所有者邀请你的 RAM 子账号并授予查看和使用该 ECS Workbench 的最小权限，不要共用阿里云主账号。

首次登录优先使用阿里云 Workbench，因为它不依赖你先配置好 SSH 白名单：

1. 在浏览器打开 [阿里云控制台](https://home.console.aliyun.com/)，登录自己的阿里云账号。进入“云服务器 ECS” -> “实例”，把地域切换到实例实际所在地域（当前 staging 是中国香港）。
2. 找到 Liteasy staging 实例。当前文档记录的公网 IPv4 是 `8.217.186.73`，但公网地址可能变化，必须以 ECS 实例详情页当前显示的地址、实例名称和实例 ID 为准；不要只凭 IP 猜测目标机器。
3. 确认实例状态为“运行中”，点击“连接”或“远程连接”，选择“Workbench”。按实例所有者提供的 Linux 用户名和已批准的密码或密钥登录。Ubuntu 用户名不能凭经验猜测；密码失败时停止，不要反复尝试、打开 root 远程登录或重置密码。
4. 进入终端后先做只读确认：

   ```bash
   whoami
   hostname
   cd /opt/liteasy/repository
   pwd
   git status --short --branch
   ```

   `pwd` 应为 `/opt/liteasy/repository`。如果目录不存在、主机名不符、Git 状态包含不认识的改动，先停下核对实例，不要创建新仓库或清理文件。
5. 需要管理员权限时使用已授权账号的 `sudo`，例如 `sudo docker ...`；不要把自己加入 `docker` 组、启用 root SSH 或把密码写入命令。完成操作后在终端执行 `exit`，再关闭 Workbench 标签页。

Workbench 登录不了时，先检查实例是否运行、RAM 账号是否有 ECS 权限以及登录用户名/凭据是否正确。不要因为 SSH 失败就开放 `22/tcp` 到全网。SSH 只是备用方式，必须先由运维人员把安全组限制为你的当前公网 IP 的 `/32`，再使用已核验的私钥连接：

```text
ssh -i <本机私钥路径> <Linux用户名>@<ECS当前公网IPv4>
```

第一次看到主机指纹时，通过阿里云/运维记录核对后再接受；指纹不符、出现 `Permission denied` 或连接超时就停止。当前交付记录显示 Windows 到服务器的 SSH 不通，因此上传安装包和首次运维默认走 Workbench，不猜测账号、不接受未知主机密钥。

### 人和 Codex 的责任边界

Codex 适合执行：

- 读取 `AGENTS.md`、代码和运行手册。
- 检查 Git、测试、构建、日志、哈希、服务状态和差异。
- 按明确范围修改文件并补测试。
- 在授权后提交、推送镜像或重启指定服务。
- 发现门禁失败后停止并给出证据。
- 整理下一位操作者可验证的交接记录。

开发者仍必须负责：

- 决定业务目标、发布范围、目标分支和候选提交。
- 审查代码与 Codex 的风险判断。
- 批准推送、部署、数据库迁移、服务重启、制品发布等外部状态变化。
- 通过安全渠道提供登录状态；不把秘密发给 Codex。
- 在阿里云/GitHub 控制台完成账单、安全组、RDS 备份、签名授权等需要账号所有权的动作。
- 对未签名 staging 例外、迁移恢复和生产发布作负责人审批。

## 2. 当前 Codex 会话的标准开场

首次发任务时把以下内容写清楚：

```text
工作目录：<绝对路径>
仓库：<owner/repository>
目标分支：<branch>
目标提交：<完整 40 位 Git SHA，尚未确定时写“请先检查，不要猜测”>
目标环境：local / controlled staging / production
本阶段目标：<只写一个阶段>
允许的外部状态变化：<例如“允许推送目标分支，不允许部署”>
禁止事项：不泄露秘密；不删除未知改动；不绕过测试/签名/OIDC/迁移门禁
停止条件：任一测试失败、状态不明、哈希不符或需要扩大范围时停止并汇报
输出要求：报告命令结果、完整 SHA、改动文件、测试、警告、未完成事项和 Git 状态
```

建议附加以下通用规则：

```text
先完整读取仓库根目录 AGENTS.md 和本阶段相关运行手册。
开始前执行只读检查，确认目录、Git 状态、分支、HEAD 和远程状态。
不要恢复、覆盖或清理你没有创建的改动。
先运行聚焦测试，再根据影响面扩大验证。
需要编辑时使用仓库既有风格并保持改动聚焦。
执行超过一分钟时持续汇报当前阶段、已确认事实和下一步。
未得到本任务明确授权时，不提交、不推送、不上传、不部署、不迁移、不重启服务。
遇到失败不要修改测试或降低安全门禁来换取通过。
最终回答必须能脱离会话上下文交给下一阶段操作者；若下一阶段仍由本机同一 Codex 执行，也必须保留这份证据。
```

## 3. Codex 的分阶段执行纪律

一次只让 Codex 完成一个可验收阶段。推荐顺序：

```text
检查 -> 诊断/实现 -> 测试 -> 代码评审 -> 提交/推送
     -> 镜像影响研判 -> 镜像构建/推送
     -> 服务器备份/部署/验收
     -> Windows 构建/实机验证
     -> 制品上传/服务器发布/外部下载验证
     -> 最终交接
```

阶段之间使用“证据包”连接，而不是“都好了”这样的自然语言结论。

### 标准证据包

要求 Codex 每阶段输出：

```text
stage:
status: passed | failed | blocked
machine_role:
working_directory:
repository:
branch_or_detached:
git_sha:
git_status_short:
inputs_verified:
changes_made:
commands_run:
tests_passed_failed_skipped:
artifacts:
hashes_or_digests:
external_state_changed:
warnings:
stop_reason:
next_authorized_action:
```

把这一段原样交给下一个阶段；只有 Windows 阶段需要交给另一台机器上的 Codex。交接时不得包含密码、cookie、AccessKey、client secret、OIDC token、SSH 私钥或下载签名 secret。

## 4. 阶段一：让 Codex 检查并修复源码

### 4.1 只诊断，不修改

当问题原因尚不明确时，先使用诊断提示词：

```text
工作目录：<repo>

请诊断以下问题，但本阶段不要修改文件、提交、推送、部署或重启服务：
<现象、错误文本、复现输入>

先读取 AGENTS.md，检查 git status、当前 SHA 和相关实现/测试。沿真实调用链定位根因，区分直接原因、系统性原因和缺失测试。请给出文件与行号证据、影响面、建议修复顺序和验证方案。不要把模型输出错误简单归因于提示词，除非代码证据支持该结论。
```

适用于薄读结构失败、白屏、OAuth、测试环境污染等复杂问题。诊断结果确认后，再开启修改阶段。

### 4.2 逐项修复并测试

```text
工作目录：<repo>
目标分支：<branch>
基线 SHA：<sha>

请根据已确认的诊断逐项修复：
1. <问题一>
2. <问题二>
3. <问题三>

先确认工作树；已有未知改动不得覆盖。每修复一项就补对应回归测试并运行聚焦测试，全部完成后运行受影响范围的完整测试和生产构建。不要修改无关代码，不要降低 schema、证据、安全或 release gate。此阶段允许修改文件和运行测试，但不允许提交、推送或部署。

最终列出每项根因、修复文件、测试结果、剩余风险和 git diff 摘要。
```

### 4.3 要求 Codex 自审

实现完成后另发：

```text
请以代码审查者身份复核当前未提交改动。优先寻找行为回归、异常路径、证据/安全门绕过、并发/持久化问题和缺失测试。先报告 findings，按严重度排序并附文件行号。不要修改文件。若没有发现问题，明确说明残余测试风险。
```

审查无阻塞项后才授权提交。

## 5. 阶段二：提交并同步远程仓库

不要在第一次修改提示词中顺带授权推送。代码和测试审阅完成后单独发送：

```text
工作目录：<repo>
目标分支：<branch>

允许你提交并推送当前已评审改动。提交前再次执行：
- git status --short
- git diff --check
- git diff 和受影响测试核验

只 add 本任务明确涉及的文件，不要使用 git add .，不提交运行配置、秘密、构建产物或未知改动。创建一个聚焦提交并推送到 origin/<branch>。推送后用 git ls-remote 验证远程分支 SHA 与本地 HEAD 完全一致。

最终返回提交主题、完整本地/远程 SHA、测试结果和最终 Git 状态。不允许合并其他分支、改写历史或部署。
```

若远程拒绝、权限不足或网络失败，让 Codex 停止。不要默认使用 `--force`，也不要换个人 fork 绕过受保护分支。

## 6. 阶段三：让 Codex 研判镜像影响

把当前运行镜像的 revision/digest 和候选 SHA 一并提供：

```text
工作目录：<repo>
候选 SHA：<candidate-sha>
当前镜像基线：
- liteasy-api: <source-sha> / <digest>
- intuecho-api: <source-sha> / <digest>
- identity-management: <source-sha> / <digest>
- staging-gateway: <source-sha> / <digest>

请只做镜像影响研判，不构建、不推送、不部署。按每个镜像实际 build context、Dockerfile、共享包、lockfile 和部署参数，从其当前 source SHA 比较到候选 SHA。逐项给出 rebuild/no rebuild、变化路径和原因。不要为了 revision 字样一致而建议重建。另列数据库 migration、Keycloak、ClamAV、配置模板和 Windows 安装包是否受影响。
```

开发者审阅结论。若只有桌面变化，应明确接受“服务器镜像无需变化”。

## 7. 阶段四：让当前服务器 Codex 构建镜像

这是当前服务器 Codex 的独立授权阶段，不是新的 Linux 构建机 Codex 会话。不要只发分支名，应固定完整 SHA：

```text
工作目录：/opt/liteasy/repository
仓库：<owner/repository>
候选 SHA：<candidate-sha>
允许重建的镜像：<explicit image list>
目标 ACR：registry.cn-hongkong.aliyuncs.com/<namespace>

请读取 AGENTS.md、direction/developer-release-and-deployment-guide.md 和 deployment/staging/README.md 第 9.2 节。先检查本机 CPU、可用内存、磁盘空间和 Docker daemon；任一资源或 Docker 前提不满足立即停止。不要覆盖当前工作树中的未知改动；如工作树不干净，使用候选 SHA 的临时干净 worktree 或先停下等待明确处理，不要 reset/clean。检出候选 SHA，确认 tracked 工作树干净。先运行受影响门禁，再只构建允许列表中的镜像，执行镜像导入/Caddy 配置验证。构建失败立即停止。

登录 ACR 时使用已有安全登录状态或交互式凭据，不显示密码。测试和镜像验证全部通过后，允许推送这些镜像。记录完整 tag 和 registry 返回的 @sha256 digest，并与远端仓库核对。禁止 latest。由于本机就是 staging ECS，若资源检查不通过必须停止，不能通过降低测试或门禁强行构建。

最终按标准证据包汇报；即使下一阶段仍由本机会话执行，也先停在部署前，不改变服务器运行状态。
```

如果本机没有 ACR 登录状态，Codex 应停在登录步骤，由开发者在终端安全交互登录，然后再回复“已登录，可以继续”。不要把密码粘贴进会话。

## 8. 阶段五：让同一服务器 Codex 部署镜像

部署提示词必须列出要变更和保持不变的 digest：

```text
工作目录：/opt/liteasy/repository
环境：controlled staging
候选 SHA：<candidate-sha>
要更新：
- <image>=<registry/image@sha256:digest>
保持不变：
- <image>=<existing digest>
数据库迁移影响：yes/no，依据：<summary>

请读取 AGENTS.md、direction/developer-release-and-deployment-guide.md 和 deployment/staging/README.md 的后续更新/回滚章节。你仍在同一台服务器和同一 Codex 会话中，但必须把本阶段当作新的授权边界。先只读检查当前 Git、Compose、容器、waitlist 和公网 readiness，并保存当前 config/Git/images 回退快照。

在改变运行状态前向我汇报：当前基线、候选 SHA、将修改的 digest、是否需要 RDS 备份/迁移、精确部署步骤和回滚条件。本阶段先停在该报告，不要部署。
```

开发者检查无误、在 RDS 控制台完成备份（如需要）后，再授权：

```text
RDS 备份任务 <backup-id> 已成功。允许按刚才报告的范围部署 controlled staging：检出精确候选 SHA，只更新列出的 digest，执行 config 校验、pull、必要的 OSS 探针和迁移、Compose up、维护单元同步及完整健康检查。

任一 migration 或 health 失败立即停止并保留日志；已应用新迁移时不得自动回滚旧镜像。不得修改未批准的 root-only secret，不得 down --volumes，不得开放内部端口。
```

如果不涉及数据库，提示词中也要明确要求 Codex 验证没有 migration path 变化，而不是省略研判。

## 9. 阶段六：让 Windows Codex 构建安装包

在 Windows 电脑打开新的 Codex 会话。对于当前推荐工作根目录 `D:\packing`，可直接发送：

```text
工作根目录：D:\packing
仓库：<owner/repository>
目标分支：<branch>
安装包源提交：<完整 40 位 SHA>
目标版本：<x.y.z>
目标环境：controlled staging

请在新的明确子目录中检出目标 SHA，读取 AGENTS.md、direction/developer-release-and-deployment-guide.md 和 direction/codex-assisted-release-and-deployment-guide.md。不要修改源码，不要删除旧 artifacts。

开始前报告：Git SHA/状态、Node/npm/rustc/cargo 版本、Rust host、VS Build Tools/Windows SDK/WebView2 前提，以及 package.json、tauri.conf.json、Cargo.toml 三处版本是否一致。

构建顺序必须是：
1. npm ci，必要时仅本次显式使用官方 npm registry，不改 lockfile/.npmrc。
2. 清除 VITE_LITEASY_CLOUD_URL、VITE_FORUM_API_URL、VITE_FORUM_WEB_URL 和 CI。
3. npm test -- --testTimeout=120000。
4. 完整测试 0 failed 且已记录预期 skipped 后，才设置三个 staging VITE URL 和 CI=true。
5. npm run build。
6. cargo check --manifest-path src-tauri\Cargo.toml。
7. npm run tauri -- build --bundles nsis。

缺少任一构建 URL 时 production_asset_boundary 应失败，不得绕过。构建或测试失败立即停止，不使用旧 target/artifacts 文件。此阶段允许本地构建，不允许上传服务器、修改 staging 或推送 Git。

成功后生成 D:\packing\artifacts\Liteasy_<version>_x64-setup.exe，确认本次候选唯一，源/交付哈希相同，并报告字节数、SHA-256、Authenticode、FileVersion、ProductVersion、x64 架构和最终 Git 状态。
```

### 9.1 测试偶发超时时如何回复 Windows Codex

如果 Codex 报告单一超时、没有断言差异，可回复：

```text
允许在不修改源码、不注入 VITE_* 和不改变测试配置的前提下，单独重跑失败测试；单独通过后必须再次运行完整测试。只有完整测试 0 failed 才能继续 build、cargo check 和 NSIS。请分别记录两次耗时和结果。仍失败则停止。
```

不要回复“忽略这一个继续构建”。

### 9.2 实机验证提示词

构建成功后再单独授权安装：

```text
允许在本 Windows 机器上验证刚生成的 <exact-path>，其期望 SHA-256 为 <hash>。不得选择其他 artifacts。

先再次核对哈希。验证静默/交互安装或升级退出码、首次启动、重启、无白屏、staging OAuth 回调、API/论坛可达、原有本地文献库保留、关键功能和关闭窗口后的主进程生命周期。不得上传服务器。不要强制结束进程来掩盖退出问题，不要清理用户数据。

最终逐项给出 passed/failed、PID/退出观察、已知警告和是否允许进入上传阶段。
```

## 10. 阶段七：上传安装包

首选 GitHub Actions OIDC。可以让 Codex 检查 workflow 和 job，但 Billing & plans、spending limit 和组织权限由账号管理员处理。job 未启动不能报告为测试失败或成功。

### GitHub Actions 提示词

```text
请只读检查 .github/workflows/windows-installer.yml、目标 tag 和候选 SHA，确认 workflow 的测试/构建变量隔离、OIDC permissions、发布条件和健康验证。不要创建或移动 tag，不触发 workflow。

报告运行前检查清单和需要我在 GitHub 界面确认的项目。
```

人工确认后再明确授权创建不可变 tag/触发 workflow。已有 tag 不得移动。

### Workbench 备用提示词

当 Actions 因计费无法启动，Windows 制品已完整验收后：

```text
本地安装包：D:\packing\artifacts\Liteasy_<version>_x64-setup.exe
期望字节数：<size>
期望 SHA-256：<hash>

请再次只读核对本地文件。此阶段不要修改源码、重新构建或操作 staging。若本机已有经过核验的服务器连接，可以上传到 /tmp/Liteasy_<version>_x64-setup.exe；若缺少 SSH 用户、端口、host key 或连接失败，立即停止，不猜测账号、不接受未知主机密钥、不请求我发送私钥/密码。

上传完成只报告远端临时路径；不要移动到 /var/lib/liteasy，不要重启服务。
```

若 SSH 不通，由开发者通过阿里云 Workbench 手工上传，然后告诉服务器 Codex：`/tmp/Liteasy_<version>_x64-setup.exe 已上传`。这句话只代表传输完成，不代表发布完成。

## 11. 阶段八：让服务器 Codex 原子发布安装包

```text
工作目录：/opt/liteasy/repository
临时上传：/tmp/Liteasy_<version>_x64-setup.exe
版本：<version>
安装包源 SHA：<installer-source-sha>
source tag：<tag>
期望大小：<size>
期望 SHA-256：<lowercase-hash>
Authenticode：Valid / NotSigned-approved-staging-only
Windows 验收摘要：<evidence>

请先只读执行 stat、sha256sum 和 file，核对全部输入；检查 /var/lib/liteasy/waitlist/releases/<version>/ 是否已存在，并读取当前 waitlist 配置/健康状态但不要显示 secret。

先向我报告核对结果、原子发布步骤、元数据字段、配置回退副本和失败回滚方案，不要发布。
```

审阅后再授权：

```text
允许按已报告方案发布这个精确制品到 controlled staging。目标版本目录必须是新的且不可覆盖，制品和 JSON 元数据为 root:root 0600；用同文件系统临时文件和原子移动。更新 waitlist 配置前保留 root-only 回退副本，重启后有限重试公网 health。失败则原子恢复旧配置并验证旧版本，不删除失败证据。

成功后通过真实下载路径再次核对大小和 SHA-256，然后才清理 /tmp 上传副本。不要修改服务器其他服务、镜像、用户数据或 secret。
```

未签名版本必须在输入中写出批准范围。Codex 不能自行推定之前对 `0.1.12` 的例外也批准了新版本。

## 12. 阶段九：最终对齐与交接

“对齐”不是把所有 revision 改成同一个值。让同一服务器 Codex 进行只读盘点：

```text
请为下一位开发者生成最终交接报告，不改变任何状态。对照：
- 远程目标分支 SHA
- 服务器仓库 SHA/状态
- 四个应用镜像的 source revision 和运行 digest
- Keycloak/ClamAV 等上游版本/digest
- 数据库备份与 migration 输出
- Windows 安装包版本、源 SHA、tag、大小、SHA-256、签名和服务器路径
- waitlist 服务与公网 health

逐项分类：一致、合理不一致、必须修复的不一致。合理不一致必须写原因，例如对应服务路径没有变化；不得为统一标签建议无意义重建。列出残余风险、停止点、回滚引用和下一位的第一组只读检查命令。
```

开发者对每个“合理不一致”做最终研判。典型可接受项：

- 桌面安装包源 SHA 新于 API 镜像，因为期间只改桌面。
- Keycloak/ClamAV 使用独立上游版本和 digest。
- Windows 复现目录停在安装包源 SHA，而开发工作目录已到最新分支 HEAD。

不可接受项：

- 服务器代码来自一个 SHA，运行了未经记录且无法追溯的镜像。
- `config.env` 使用 tag/`latest` 而非 digest。
- 安装包服务器哈希与 Windows 证据不一致。
- 已应用迁移没有备份、输出或兼容性记录。
- 对外称生产发布，但制品未签名或生产门禁未完成。

## 13. 常见 Codex 交互错误

### 指令过宽

错误：

```text
把最新版部署一下。
```

正确：指定目录、完整 SHA、环境、阶段、允许变化和停止条件。

### 把“继续”当作授权

“继续检查”不等于允许推送、部署或删除。涉及外部状态时明确写：

```text
允许执行 X；不允许执行 Y；在 Z 前停下汇报。
```

### 让 Codex 猜秘密或账号

不要发送密码、token、私钥或 AccessKey。账号/端口未知时先由资产所有者确认；凭据由人在安全交互界面输入。

### 只给自然语言结果，不给证据

“测试通过”“已上传”“服务正常”都不够。必须附 SHA、状态、数量、路径、字节数、hash/digest 和具体 health。

### 失败后要求绕过

不要让 Codex 扩大 timeout 到无限、删除失败测试、关闭 production asset boundary、放宽 OIDC、改 migration checksum 或忽略签名。先区分环境问题、偶发超时和真实回归，然后按原门禁完整复跑。

### 在跨 Windows 机器时使用隐含上下文

当前服务器的源码、镜像和部署阶段共享文件系统，但 Windows Codex 不共享服务器状态。跨机器时只信显式证据包，重新提供完整输入，不依赖“你应该知道上一台电脑做了什么”。

## 14. 一次完整发布的最短提示词索引

| 阶段 | 给 Codex 的核心动词 | Codex 必须停在哪里 |
| --- | --- | --- |
| 诊断 | 检查、追踪、解释 | 修改前 |
| 修复 | 编辑、补测试、验证 | 提交前 |
| 审查 | 查回归和风险 | 不修改 |
| 同步 | 提交、推送、核对远程 SHA | 部署前 |
| 镜像研判 | 比路径和上下文 | 构建前 |
| 镜像构建 | 测试、build、push、取 digest | ECS 部署前 |
| ECS 预检 | 快照、计划、确认备份需求 | 改运行状态前 |
| ECS 部署 | pull、迁移、up、验收 | 安装包发布前 |
| Windows 构建 | 测试、build、Cargo、NSIS | 上传前 |
| Windows E2E | 安装、启动、OAuth、数据、退出 | 上传前 |
| 临时上传 | 核对、上传 `/tmp` | `/var/lib` 前 |
| 制品发布 | 独立核验、原子发布、health | 清理 `/tmp` 前 |
| 交接 | 盘点、分类不一致、写证据 | 不改变状态 |

## 15. Codex 最终回报模板

要求每一位 Codex 用以下格式结束，便于直接交给下一位：

```text
结果：PASSED / FAILED / BLOCKED
阶段：
机器与工作目录：
仓库/分支/完整 SHA：
Git 状态：

已执行：
- <item>

验证：
- 测试：<passed/failed/skipped/duration>
- 构建：
- 镜像 digest 或制品 SHA-256：
- 运行 health：

外部状态变化：
- Git remote：none / exact change
- ACR：none / exact images
- staging：none / exact services/config
- 用户数据：none / exact approved change

警告与合理未对齐：
- <item>

停止原因或残余风险：
- <item>

下一步允许动作：
- <item>
```

缺少字段应写 `not applicable` 或 `not executed`，不能留空让下一位猜测。只有证据闭环、停止点处理完毕、负责人明确批准后，才能把状态从“候选”改为“已在 controlled staging 发布”。

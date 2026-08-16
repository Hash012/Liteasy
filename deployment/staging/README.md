# 阿里云香港预发布环境：第一次部署操作手册

本手册面向第一次使用服务器的操作者，目标是在阿里云香港地域建立 Liteasy/Intuecho 的私有预发布环境。当前发布目标严格限定为**受控的 10 人限量预发布**，用于真实依赖联调和具名受邀测试，不等于公开测试或生产环境验收通过。

> 当前仍不能直接邀请用户测试。仓库已提供阿里云 OSS 安全适配和真实 ClamAV PDF 扫描服务，但必须在目标资源上重复验收；Keycloak 邮箱与 MFA、Windows 安装包签名和下载发布仍未完成。本文会明确标出这些停止点，不要使用假地址、演示服务或关闭安全检查来绕过它们。

> 不要在聊天、Git、工单、截图或 Shell 命令中发送或记录密码、私钥、AccessKey、client secret。需要协作时只提供 ECS 私网 IP、RDS 内网域名、bucket 名、endpoint、ACR 地址等非敏感信息。

> 10 人是账号总量上限，不是并发承诺。当前 2 vCPU、4 GiB ECS 曾在无用户负载时发生 `freshclam` OOM，因此人数少不能作为不会 OOM 的证据。必须执行本文的单路 PDF 扫描、32 MiB 文件上限、资源告警和自动停止条件；未完成容量验收前不得扩大用户数或开放注册。

## 本文当前是否完整

结论：**服务器基础部署步骤可以按本文继续建立，但整个“邀请用户下载安装并使用”的发布链目前还没有完整闭环。** 开始操作前先接受下表中的真实状态：

| 范围 | 当前状态 | 能否继续 |
| --- | --- | --- |
| DNS、安全组、ECS、RDS、ACR、Compose 和 Caddy | 本文提供逐步操作 | 可以按顺序建立 |
| OSS 作为现有 S3 客户端后端 | 已有显式 `aliyun-oss` 安全模式，仍须用真实 bucket 运行探针 | 探针通过后才能继续 Liteasy |
| PDF 安全扫描 | 已有私有 HTTPS ClamAV 部署 | EICAR、鉴权、哈希绑定和故障关闭验收通过后可以继续 |
| Keycloak 邮件、MFA、恢复 | 需要真实 SMTP 和人工 E2E | 验收通过前不能邀请用户 |
| Windows Authenticode 签名 | `0.1.12` 已按负责人批准作为未签名受控 staging 例外发布 | 生产和不受控公开发布仍是阻塞项 |
| 官网安装包下载 | 受控 staging 已通过短时令牌和 root-only 不可变版本目录提供 | 生产级制品服务、签名和完整 E2E 仍是阻塞项 |
| RDS 恢复、监控和告警 | 本文给出配置与演练步骤，但必须在你的阿里云账号中实际完成 | 没有证据前不能宣称已完成 |

### 受控 10 人预发布边界

本环境达到第 15 节门禁后，只能按以下边界发布：

| 项目 | 强制边界 |
| --- | --- |
| 用户 | 最多 10 个具名受邀账号；不得使用共享账号、公开邀请码或匿名注册 |
| 注册 | 邀请和验证期间逐个创建账号；第 10 个账号完成后关闭 Keycloak 自助注册。替换人员时先禁用并审计旧账号，再创建新账号 |
| 登录安全 | 真实 SMTP、邮箱验证、MFA、恢复流程和具名管理员仍是发布前置条件，不因用户少而豁免 |
| AI/生成能力 | `modelProxy` 已为薄读受控测试配置；仅限具名测试账号和已批准的部署密钥，不扩大并发、不开放匿名访问，也不承诺高内存批处理能力 |
| PDF | 单文件最多 32 MiB；扫描器最多同时处理 1 个请求；不得批量上传或并发发起 PDF/OCR 任务 |
| 流量 | 不进行公开推广、开放注册或自动化压测；测试者按预约窗口使用大 PDF/OCR 功能 |
| 运维 | 发布窗口必须有维护者值守，并具备关闭注册、暂停上传或停止测试的权限 |
| 扩容 | 增加第 11 个账号、提高 PDF 上限/并发、开放模型能力或转为公开测试前，先升级到至少 4 vCPU、8 GiB 并重新完成容量验收 |

任一条件发生时立即停止新增登录和 PDF 上传，保留日志并进入故障处理：宿主机或容器出现 OOM；任一核心容器意外重启；可用内存持续 5 分钟低于 15%；swap 使用持续 5 分钟高于 75%；任一公网 readiness 连续两次失败；PDF 扫描出现非验收操作导致的 `clamav_connection_failed`。恢复后必须重新执行健康、扫描和受控并发验收，不能只看容器重新变为 `healthy`。

“文档写完”不等于“外部资源已经存在”。遇到上述阻塞项时，正确动作是停在该节并补齐真实服务或负责人，而不是填写一个假地址继续启动。

## 如何使用本手册

先看每段开头写的是在哪里操作，不要把不同环境的命令混在一起：

| 操作位置 | 含义 |
| --- | --- |
| 阿里云控制台 | 在自己电脑的浏览器中登录阿里云后操作，不是在 ECS 终端输入命令 |
| 自己的 Windows 电脑 | 使用本机 PowerShell、浏览器或 SSH 客户端 |
| ECS | 使用阿里云 Workbench 或 SSH 登录 `8.217.186.73` 后，在 Ubuntu 终端执行 |
| 构建机 / CI | 由代码维护者控制、装有 Node.js 20+ 和 Docker 的构建环境；不是这台 2 vCPU、4 GiB ECS |

必须按章节顺序执行。每一节的验证结果符合预期后再继续；遇到“停止”字样就不要自行填写假值绕过。大致分为四个阶段：

1. 第 3～8 节：建立 DNS、安全组、ECS、RDS 和 OSS 等云资源。
2. 第 8～10 节：由维护者部署并验收 OSS 适配、PDF 扫描服务、镜像和 root-only 运行配置。
3. 第 11 节：迁移数据库、启动服务并逐项验收。
4. 第 12～15 节：签名 Windows 安装包，完成上线门禁。

执行时建立一个不含秘密的部署记录，至少逐项记录：章节号、操作人、开始/结束时间、阿里云资源 ID、Git SHA、镜像 digest、RDS 备份任务 ID、验证结果和故障单号。密码、私钥、AccessKey、token 和 client secret 永远不写入记录。

## 1. 最终结构是什么

用户只访问 HTTPS 域名，不直接访问应用内部端口：

```text
浏览器 / Windows 客户端
          |
          | HTTPS 443
          v
阿里云 DNS -> ECS 公网 IP 8.217.186.73
                    |
                    v
                  Caddy
          +---------+---------+---------+
          |         |         |         |
       静态网页   Liteasy   Intuecho  Keycloak
                 API 8787   API 4040   8080
                    |
                    | ECS 私网
          +---------+----------+-----------+
          |                    |           |
     RDS PostgreSQL       对象存储      PDF 扫描服务
```

内部端口 `4040`、`8080`、`8787`、`9000` 和 `9090` 只在 Docker 网络中使用。安全组和 Docker 都不应把这些端口发布到互联网。Caddy 是唯一公网入口，对外只监听 `80` 和 `443`。

当前 ECS 为 2 vCPU、4 GiB，只允许本文定义的 10 人限量、低并发预发布。公开测试、超过 10 个账号或提高 PDF/AI 并发前，至少升级到 4 vCPU、8 GiB，或者把 Keycloak 和扫描服务迁出此 ECS。Swap 只能缓解偶发内存压力，不能替代升级。

## 2. 先理解这些词

| 词语 | 本手册中的含义 |
| --- | --- |
| 域名 | 便于人记忆的地址，例如 `api.staging.liteasyclaw.com` |
| IP 地址 | 服务器的网络地址；当前 ECS 公网 IPv4 是 `8.217.186.73` |
| A 记录 | 把一个域名解析到一个 IPv4 地址的 DNS 记录 |
| 端口 | 同一台服务器上的服务入口编号；HTTPS 通常使用 `443`，SSH 通常使用 `22` |
| TCP / UDP | 两种网络传输协议；本项目首次部署只必须开放 TCP `80/443` |
| `0.0.0.0/0` | 所有 IPv4 地址；只能用于必须公开的 Web 端口，不能用于 SSH |
| `x.x.x.x/32` | 只允许一个精确 IPv4 地址，例如 `203.0.113.10/32` |
| 安全组 | 阿里云位于 ECS 外层的网络防火墙，先于服务器内的应用生效 |
| Caddy | 接收公网请求、申请 HTTPS 证书，并按域名把请求转给不同服务 |
| HTTPS / TLS 证书 | 浏览器用来确认“当前连接的确是这个域名且传输已加密”的公网证书 |
| 反向代理 | Caddy 在公网入口接收请求，再转发给 Docker 内部服务；用户不会直接连接内部端口 |
| VPC / 私网 IP | 阿里云资源之间使用的隔离网络和内部地址，不能从普通互联网直接访问 |
| RDS | 阿里云托管数据库；本项目使用 PostgreSQL，并且只开放内网连接 |
| OSS / S3 | 对象存储及其接口；用于保存 PDF 等文件，不等同于 ECS 磁盘 |
| ACR | 阿里云容器镜像服务，ECS 从这里拉取已构建的应用镜像 |
| root-only 运行配置 | `/etc/liteasy/staging/*.env`；由 root 保管密码和 client secret，不写进代码仓库 |
| Docker Compose | 按 `compose.yaml` 一次启动和连接多个容器的工具 |
| 镜像 | 容器应用的只读打包产物 |
| digest | 镜像内容的固定 SHA-256 身份；相同 digest 表示相同内容 |
| 预发布 | 与正式结构相似但数据、域名、密钥全部独立的测试环境 |
| readiness | 服务对数据库、OIDC、存储等依赖进行检查后的“可接流量”状态 |

## 3. 开始前准备一张资源表

先记录以下信息。尖括号表示你必须替换的值，不要把尖括号原样输入控制台或命令行。

| 项目 | 当前值或示例 | 从哪里获得 | 是否可公开 |
| --- | --- | --- | --- |
| ECS 公网 IP | `8.217.186.73` | ECS 实例详情 | 可以 |
| 公网 IP 类型 | `<EIP_ID>` 或“固定保留的实例公网 IP” | EIP/ECS 网络详情 | 可以 |
| ECS 私网 IP | `<ECS_PRIVATE_IP>` | ECS 实例详情的“私网 IP” | 可以 |
| 你的当前公网 IPv4 | `<YOUR_PUBLIC_IP>` | 在自己的电脑上查询，不是在 ECS 上查询 | 可以 |
| ECS VPC / 交换机 | `<VPC_ID>` / `<VSWITCH_ID>` | ECS 网络信息 | 可以 |
| RDS 内网地址 | `<RDS_INTERNAL_HOST>` | RDS 数据库连接页 | 可以 |
| RDS CA 文件 | `aliyun-rds-ca.pem` | RDS SSL 配置页下载 | 可以 |
| OSS bucket | `liteasy-staging-hk-<随机后缀>` | OSS 控制台 | 可以 |
| OSS endpoint | `https://oss-cn-hongkong.aliyuncs.com` | OSS bucket 概览 | 可以 |
| ACR registry | `registry.cn-hongkong.aliyuncs.com` | ACR 控制台 | 可以 |
| ACR 镜像前缀（文中的 `<acr>`） | `registry.cn-hongkong.aliyuncs.com/liteasy` | registry 加 ACR namespace | 可以 |
| 已评审提交（文中的 `<git-sha>`） | `git rev-parse HEAD` 的输出 | 构建机 | 可以 |
| 证书通知邮箱 | `<MONITORED_EMAIL>` | 你能正常收信的运维邮箱 | 可以 |
| 学术接口联系邮箱 | `<RESEARCH_CONTACT_EMAIL>` | 你能正常收信且允许对外显示的邮箱 | 可以 |
| 所有密码和 secret | 不写入此表 | 对应云账号/服务控制台或 root-only env；另做加密离线备份 | 不可以 |
| SSH 私钥 | 只保存在你的电脑 | 创建 ECS 密钥对时获得 | 不可以 |

你的公网 IP 可能会变化。在自己的 Windows PowerShell 执行下列命令，记录返回的 IPv4；不要在 ECS 上执行，因为那会得到服务器出口 IP：

```powershell
(Invoke-RestMethod -Uri "https://api.ipify.org").Trim()
```

如果正在使用公司 VPN，返回的是 VPN 出口 IP，之后访问 SSH 和 Keycloak 管理页时必须保持同一 VPN。也可以用浏览器访问另一个可信 IP 查询服务交叉确认。文档示例 `203.0.113.10` 是保留的示例地址，绝不能当成你的真实地址使用。

### 3.1 先确认公网 IP 不会在停机后变化

操作位置：阿里云控制台。

DNS 会把六个域名长期指向 `8.217.186.73`。如果该地址在 ECS 释放、停机或网络变更后被回收，所有网站和证书验证都会同时中断。因此在添加 DNS 前执行：

1. 打开“弹性公网 IP”控制台，地域选择“中国香港”。
2. 搜索 `8.217.186.73`。如果能找到一条状态为“已绑定”、绑定资源正是目标 ECS 的 EIP，记录 EIP 实例 ID。
3. 如果 EIP 控制台找不到该地址，回到 ECS 实例的“网络与安全组/弹性网卡”详情，确认它是可长期保留的公网 IP，还是随实例释放的临时地址。
4. 如果控制台明确提示地址会随实例释放，先购买中国香港 EIP 并绑定这台 ECS，或者使用控制台提供的“转换为弹性公网 IP”功能。绑定可能改变 IP 并产生费用，先阅读控制台价格确认页。
5. 如果最终公网 IP 不再是 `8.217.186.73`，先把本文所有实际操作中的 IP 替换成新 EIP，再配置第 4 节 DNS。不要让一部分 A 记录指向旧 IP、一部分指向新 IP。

验证结果：资源详情应显示固定公网地址已绑定到目标 ECS。无法确认地址保留策略时停止，请阿里云工单确认，不要先申请公网证书。

## 4. 配置 DNS A 记录

A 记录只做一件事：告诉互联网“访问这个域名时，应连接哪一个 IPv4 地址”。例如，主机记录 `community.staging` 与根域名 `liteasyclaw.com` 组合后得到 `community.staging.liteasyclaw.com`，它的记录值是 ECS 公网 IP `8.217.186.73`。

记录值中只填写 IP，不要填写 `https://`、路径或端口。A 记录本身不会安装网站，也不会申请证书；它只是后续 Caddy 能申请证书的前提。当前不要添加 AAAA 记录或通配符 `*` 记录。

### 4.1 在阿里云控制台添加

1. 登录阿里云控制台。
2. 打开“云解析 DNS”。
3. 进入“权威域名解析”或“域名解析”，选择 `liteasyclaw.com`。
4. 点击“解析设置”或“添加记录”。
5. 选择手动“添加记录”，逐条添加下表。记录类型选择 `A`，解析请求来源/线路选择“默认”，TTL 使用默认值（通常为 600 秒），记录值全部填写 `8.217.186.73`，状态保持“启用”。

| 主机记录 | 最终完整域名 | 记录值 |
| --- | --- | --- |
| `staging` | `staging.liteasyclaw.com` | `8.217.186.73` |
| `community.staging` | `community.staging.liteasyclaw.com` | `8.217.186.73` |
| `admin.staging` | `admin.staging.liteasyclaw.com` | `8.217.186.73` |
| `api.staging` | `api.staging.liteasyclaw.com` | `8.217.186.73` |
| `auth.staging` | `auth.staging.liteasyclaw.com` | `8.217.186.73` |
| `identity.staging` | `identity.staging.liteasyclaw.com` | `8.217.186.73` |

不要在“主机记录”中再次填写 `liteasyclaw.com`。例如第一条只填 `staging`，阿里云会自动拼成完整域名。

### 4.2 在自己的 Windows 电脑验证

打开 PowerShell，执行：

```powershell
$names = @(
  "staging.liteasyclaw.com",
  "community.staging.liteasyclaw.com",
  "admin.staging.liteasyclaw.com",
  "api.staging.liteasyclaw.com",
  "auth.staging.liteasyclaw.com",
  "identity.staging.liteasyclaw.com"
)
$names | ForEach-Object { Resolve-DnsName $_ -Type A }
```

成功时，`IPAddress` 或 `Address` 应显示 `8.217.186.73`。如果仍没有结果或结果是旧 IP：

1. 等待 10～30 分钟。
2. 确认记录状态为“启用”。
3. 确认添加的是 A 记录而不是 CNAME。
4. 不要继续申请证书，直到六个域名都解析正确。

## 5. 配置 ECS 安全组

### 5.1 安全组在做什么

安全组决定互联网能否到达 ECS 的某个端口。它和 Caddy 是两层不同的保护：

- 安全组先决定连接能不能进入 ECS。
- 进入 `80/443` 后，Caddy 再根据域名和路径决定转给谁。
- 因此，Keycloak 使用内部端口 `8080`，但你绝不能在安全组开放 `8080`。
- “返回 404”是 Caddy 收到 HTTPS 请求后的主动隐藏，不是让你创建一个 404 端口。

### 5.2 添加入方向规则

以下操作都在阿里云控制台完成：

1. 打开“云服务器 ECS”。
2. 进入“实例”，选择公网 IP 为 `8.217.186.73` 的实例。
3. 打开“安全组”页签。ECS 可能同时加入多个安全组；记下所有已绑定安全组，并逐个检查，因为任意一个安全组的宽松规则都可能产生暴露。
4. 点击安全组 ID，进入“安全组规则”，选择“入方向”或“Inbound”。
5. 选择“手动添加”，每一行单独创建一条规则，不要使用“全部端口”或把多个端口合并成大范围。
6. 按下表填写。控制台字段名称可能显示为“授权对象”或“源”，含义相同。优先级数字越小通常越高；这里统一填写 `1`，并确保没有同优先级的冲突拒绝规则。

| 用途 | 动作 | 协议 | 目的端口范围 | 授权对象/来源 | 优先级 | 描述 |
| --- | --- | --- | --- | --- | --- | --- |
| SSH 运维（每个来源 IP 一条） | 允许 | 自定义 TCP | `22/22` | `<YOUR_PUBLIC_IP>/32` | `1` | `SSH-only-from-operator` |
| HTTP 证书验证和跳转 | 允许 | 自定义 TCP | `80/80` | `0.0.0.0/0` | `1` | `Public-HTTP-for-Caddy` |
| HTTPS 网站和 API | 允许 | 自定义 TCP | `443/443` | `0.0.0.0/0` | `1` | `Public-HTTPS` |
| HTTP/3 | 允许 | 自定义 UDP | `443/443` | `0.0.0.0/0` | `1` | `Optional-HTTP3` |

最后一条 UDP `443` 是可选项，第一次部署先不要添加。浏览器会自动改用 TCP HTTPS，不会因此打不开网站。

仅演示填写格式：假设你查询到的公网 IPv4 是 `203.0.113.10`，SSH 授权对象就填写 `203.0.113.10/32`。`203.0.113.10` 是专门用于文档的保留地址，不是你的真实 IP。家庭宽带 IP 变化后，SSH 可能超时；此时先在阿里云控制台更新这条 `/32` 规则，不要临时把 SSH 改成全网开放。保存安全组规则后不需要重启 ECS。

### 5.3 删除危险的入方向规则

检查 ECS 绑定的每一个安全组，确保互联网来源 `0.0.0.0/0` 或 IPv6 全网来源 `::/0` 没有访问以下端口：

- `4040`：Intuecho API 内部端口
- `8080`：Keycloak 内部端口
- `8787`：Liteasy API 内部端口
- `9000`：Keycloak 管理/健康端口
- `9090`：identity-management 内部端口
- `5432`：PostgreSQL

如果有“全部协议、全部端口、来源 `0.0.0.0/0`”之类的规则，应删除或禁用。安全组对未允许的入站连接默认拒绝，所以不需要再建立一条“拒绝全部端口”规则。如果 ECS 已分配公网 IPv6，但当前不使用 IPv6，应取消公网 IPv6 或请运维人员建立等价的 IPv6 限制。

不要删除阿里云平台明确要求且你理解用途的系统规则；不确定时先记录规则 ID、协议、端口、来源和描述，不要记录或截图任何密钥。

### 5.4 出方向规则

首次预发布可保留安全组默认的出方向允许规则，因为 ECS 需要访问 RDS、OSS、ACR、OIDC、证书服务和学术数据源。Compose 的 `egress` 网络不是出站防火墙。生产前再根据真实调用清单，用云防火墙、NAT 或代理收紧目的地址。

### 5.5 Keycloak 管理页面和 404 的具体含义

公网 OIDC 登录端点和 Keycloak 管理路径 `/admin` 都通过 HTTPS 公网入口提供。配置完成后可以打开：

```text
https://auth.staging.liteasyclaw.com/admin/
```

公网开放只代表登录页面可被访问，不代表任何人拥有管理权限。每位管理员仍必须使用自己的具名 Keycloak 管理员账号、强密码和 MFA，不能共用账号。绝不能为了访问管理页而开放 Keycloak 容器的内部端口 `8080`。

`identity.staging.liteasyclaw.com` 是服务间账号生命周期接口，不是管理网页。它始终拒绝普通公网来源；不要为它增加公网白名单。当前 DNS 必须直接解析到 ECS，不要在前面临时加入 CDN 或其他代理，否则 Caddy 看到的来源 IP 会变化，白名单规则需要另行评审。

## 6. 第一次登录并初始化 ECS

### 6.1 先用阿里云 Workbench 登录

第一次操作优先使用阿里云控制台中的“远程连接 / Workbench”，这样即使 SSH 规则配置错误，仍有控制台恢复入口。

登录后执行：

```bash
cat /etc/os-release
uname -m
free -h
df -h /
```

应确认：

- 系统为 Ubuntu 22.04。
- 架构为 `x86_64`。如果是 ARM，停止操作；当前验证镜像基线不是按这台 ARM 主机验收的。
- 可用磁盘至少还有 15 GiB。
- 内存约 4 GiB。

### 6.2 更新系统并安装基础工具

以下命令只适用于第 6.1 节已经确认的 Ubuntu 22.04、`x86_64` 新 ECS。先更新系统并安装基础工具：

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl git jq dnsutils openssl postgresql-client rsyslog ufw
sudo systemctl enable --now rsyslog
```

然后使用 Docker 官方 Ubuntu 软件源安装 Docker Engine 和 Compose v2：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu jammy stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

如果下载 GPG key 失败、apt 报签名错误，或提示与已有 `docker.io`/`containerd` 包冲突，应停止并保存错误文字给维护者。不要关闭签名验证，不要执行来源不明的“一键安装脚本”，也不要同时混用 Ubuntu 与 Docker 官方两套 Docker 包。

验证：

```bash
sudo docker version
sudo docker compose version
sudo systemctl is-active docker
sudo systemctl is-active rsyslog
```

第一条应显示客户端和服务端版本，第二条应显示 `Docker Compose version v2...`，最后两条都应输出 `active`。本手册统一使用 `sudo docker`，不把普通用户加入 `docker` 组，因为该组等价于 root 权限。

如果系统升级提示需要重启，执行 `sudo reboot`，等待约一分钟后重新连接。

### 6.3 检查 Ubuntu 主机防火墙

安全组位于 ECS 外层，Ubuntu 的 UFW 位于主机内层。先检查状态：

```bash
sudo ufw status verbose
```

如果输出 `Status: inactive`，首次远程部署先保持不变，由阿里云安全组承担外层限制。不要在尚未验证 Workbench 恢复入口时直接执行 `ufw enable`，否则错误规则可能让你无法登录。

如果输出 `Status: active`，必须先把 `<YOUR_PUBLIC_IP>` 替换成真实公网 IP，再执行：

```bash
sudo ufw allow from <YOUR_PUBLIC_IP> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status numbered
```

只有启用 HTTP/3 时才额外执行 `sudo ufw allow 443/udp`。如果 UFW 中已有 `22/tcp ALLOW Anywhere`、`8080 ALLOW Anywhere` 等宽松规则，先用 Workbench 确认窄规则可用，再由运维人员删除宽松规则。

Docker 发布端口时会管理主机网络规则，因此 UFW 不能替代阿里云安全组和 Compose 端口检查。本项目仍然必须保证只有 gateway 发布 `80/443`。

### 6.4 确认容器日志有容量上限

操作位置：ECS。

本仓库的 `compose.yaml` 已给每个容器设置 Docker `json-file` 日志上限：单个文件 `10m`，最多保留 `5` 个。这样单个容器的本地 Docker 日志通常不会无限增长，但它不代替第 11.10 节的集中日志和磁盘告警。

**此时容器还没有创建，不要执行 `docker inspect liteasy-staging-gateway-1`。** 如果执行后看到 `error: no such object`，只表示尚未启动 gateway，属于当前阶段的预期结果。先继续第 6.5 节；真正的日志轮转检查放在第 11.4 节启动容器之后，并使用 Compose 动态取得实际容器名称。

### 6.5 创建固定目录并配置只读 GitHub deploy key

操作位置：先在 ECS 生成公钥，再在自己电脑的 GitHub 网页中登记公钥，最后回到 ECS 克隆。

正式镜像不在 ECS 上构建，但 Compose 文件、Caddyfile 和 Keycloak realm 必须与镜像来自同一个已评审 Git SHA。本文后续所有 ECS 命令都假定仓库固定在：

```text
/opt/liteasy/repository
```

先在 ECS 创建目录和专用 SSH 密钥。以下命令不会显示私钥内容：

```bash
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0750 /opt/liteasy
install -d -m 0700 "$HOME/.ssh"
ssh-keygen -t ed25519 -C "liteasy-staging-readonly" -f "$HOME/.ssh/liteasy_staging_deploy" -N ""
chmod 0600 "$HOME/.ssh/liteasy_staging_deploy"
chmod 0644 "$HOME/.ssh/liteasy_staging_deploy.pub"
cat "$HOME/.ssh/liteasy_staging_deploy.pub"
```

最后一条只显示 `.pub` 公钥，可以登记到 GitHub；绝不能显示、复制或上传没有 `.pub` 后缀的私钥。

在自己的电脑浏览器打开 GitHub 仓库 `Hash012/Liteasy`：

1. 进入 `Settings -> Deploy keys -> Add deploy key`。如果看不到 `Settings`，说明当前 GitHub 账号没有仓库管理权限，停止并联系仓库所有者。
2. Title 填写 `aliyun-hk-staging-readonly`。
3. Key 粘贴 ECS 上刚才显示的整行公钥。
4. **不要勾选 `Allow write access`**。
5. 保存。一个 deploy key 只用于这个仓库，不要把同一私钥复制到其他服务器。

回到 ECS，编辑 SSH 配置：

```bash
nano "$HOME/.ssh/config"
```

如果文件已有内容，在末尾新增下面五行，不要覆盖原内容：

```sshconfig
Host github-liteasy-staging
  HostName github.com
  User git
  IdentityFile ~/.ssh/liteasy_staging_deploy
  IdentitiesOnly yes
```

保存后执行：

```bash
chmod 0600 "$HOME/.ssh/config"
ssh -T git@github-liteasy-staging
```

第一次连接会询问是否信任 `github.com` 主机指纹。先在 GitHub 官方文档的“SSH key fingerprints”页面核对终端显示的 SHA256 指纹，完全一致才输入 `yes`。成功时 GitHub 会显示“successfully authenticated, but GitHub does not provide shell access”之类文字；该命令可能返回退出码 `1`，这句认证成功文字才是判断依据。指纹不同或出现 `Permission denied (publickey)` 时停止。

然后克隆并检出维护者提供的完整 40 位 `<git-sha>`：

```bash
test ! -e /opt/liteasy/repository && echo "repository path is empty"
git clone git@github-liteasy-staging:Hash012/Liteasy.git /opt/liteasy/repository
cd /opt/liteasy/repository
git fetch --prune origin
git checkout --detach <git-sha>
git rev-parse --show-toplevel
git rev-parse HEAD
git status --short
```

第一条必须输出 `repository path is empty`。如果没有输出，说明该目录已经存在；停止并先确认它是完整旧仓库还是失败的半成品，不要直接删除。成功判据：仓库根目录输出 `/opt/liteasy/repository`；`git rev-parse HEAD` 与构建镜像使用的完整 `<git-sha>` 逐字符相同；`git status --short` 没有输出。不要使用 `git pull` 自动追随分支，也不要把个人 Git 密码或长期 PAT 写在克隆 URL 中。

## 7. 创建 RDS PostgreSQL

### 7.1 创建实例

在阿里云 RDS 控制台创建 PostgreSQL 实例：

- 地域：香港，与 ECS 相同。
- 数据库版本：PostgreSQL 16。
- 网络类型：专有网络 VPC。
- VPC 和交换机：与 ECS 相同。
- 连接方式：只使用内网地址，不申请公网数据库地址。
- 存储：预发布至少 20 GiB，并启用存储自动扩容或容量告警。
- 备份：启用自动备份和 PITR；保留期至少覆盖你的测试周期。
- 规格：预算有限的私有预发布可使用基础版；公开测试和生产必须另行评估高可用版。

创建后，把 RDS 内网地址记录为 `<RDS_INTERNAL_HOST>`。不要记录密码。

实例创建完成后，立即进入“备份恢复 -> 备份策略”检查：

1. 数据备份周期至少勾选每天，保留天数不得少于 `7` 天；如果测试周期超过 7 天，保留期覆盖整个测试周期。
2. 日志备份/PITR 状态必须为“开启”。记录控制台显示的最早可恢复时间和当前可恢复时间。
3. 备份时间窗口选择业务低峰，并确认时区是控制台显示的地域时区，不要凭本地电脑时间猜测。
4. 打开备份失败、存储容量和连接数告警；具体告警联系人在第 11.10 节统一创建。

若控制台没有 PITR 选项，或当前实例规格不支持按时间点恢复，停止并更换支持该能力的 RDS 规格。只看到“已开启自动备份”而没有可恢复时间范围，不算 PITR 已验证。

### 7.2 创建数据库和账号

创建彼此独立的数据库与账号：

| 数据库 | 所有者/迁移账号 | 运行账号 | 权限要求 |
| --- | --- | --- | --- |
| `liteasy` | `liteasy_migrator` | `liteasy_app` | migrator 可执行 DDL；app 只能连接并由迁移程序授予运行时 DML |
| `intuecho` | `intuecho_migrator` | `intuecho_app` | migrator 可执行 DDL；app 只能连接并由迁移程序授予运行时 DML |
| `keycloak` | `keycloak_app` | 无第二账号 | `keycloak_app` 是该数据库 schema 所有者 |

具体操作：

1. 在 RDS“账号管理”中创建上述五个登录账号。
2. 每个账号使用不同的、至少 32 字符的随机密码。
3. 数据库密码优先只使用 URL 安全字符 `A-Z a-z 0-9 . _ ~ -`，避免后续手工 URL 编码出错。
4. 在“数据库管理”中创建三个数据库，并按上表指定所有者。
5. 不要把 `liteasy_app` 或 `intuecho_app` 设置为高权限账号、超级账号或数据库所有者。
6. 不要让 Liteasy 与 Intuecho 共用账号或密码。

如果阿里云控制台不能精确设置所有者和 CONNECT 权限，应使用 RDS 提供的 DMS/SQL 控制台，由 RDS 高权限运维账号完成初始化；不要擅自给应用账号 DDL 权限来“解决”报错。

### 7.3 配置白名单和 TLS

1. 在 RDS“白名单与安全组”中，只加入 ECS 私网 IP `<ECS_PRIVATE_IP>`。如果界面要求 CIDR，填写 `<ECS_PRIVATE_IP>/32`。
2. 不要加入 ECS 公网 IP，也不要填写 `0.0.0.0/0`。
3. 在 RDS SSL/TLS 设置中启用加密连接。
4. 下载当前 CA 证书链到自己的电脑，再通过 Workbench 文件上传功能上传到 ECS。
5. 在 ECS 上安装证书：

```bash
sudo install -d -o root -g root -m 0700 /etc/liteasy/staging
sudo install -o root -g root -m 0644 <上传后的CA文件路径> /etc/liteasy/staging/aliyun-rds-ca.pem
```

执行前替换 `<上传后的CA文件路径>`，例如 `/home/ubuntu/aliyun-rds-ca.pem`。

### 7.4 从 ECS 验证数据库连接

让 `psql` 交互式询问密码，不要把密码放进命令：

```bash
psql "host=<RDS_INTERNAL_HOST> port=5432 dbname=liteasy user=liteasy_app sslmode=verify-full sslrootcert=/etc/liteasy/staging/aliyun-rds-ca.pem" -W -c "select current_database(), current_user;"

psql "host=<RDS_INTERNAL_HOST> port=5432 dbname=liteasy user=liteasy_migrator sslmode=verify-full sslrootcert=/etc/liteasy/staging/aliyun-rds-ca.pem" -W -c "select current_database(), current_user;"

psql "host=<RDS_INTERNAL_HOST> port=5432 dbname=intuecho user=intuecho_app sslmode=verify-full sslrootcert=/etc/liteasy/staging/aliyun-rds-ca.pem" -W -c "select current_database(), current_user;"

psql "host=<RDS_INTERNAL_HOST> port=5432 dbname=intuecho user=intuecho_migrator sslmode=verify-full sslrootcert=/etc/liteasy/staging/aliyun-rds-ca.pem" -W -c "select current_database(), current_user;"

psql "host=<RDS_INTERNAL_HOST> port=5432 dbname=keycloak user=keycloak_app sslmode=verify-full sslrootcert=/etc/liteasy/staging/aliyun-rds-ca.pem" -W -c "select current_database(), current_user;"
```

每条命令都会单独询问对应账号密码。五条都必须成功，并分别显示下列组合：

| 命令 | `current_database` | `current_user` |
| --- | --- | --- |
| 1 | `liteasy` | `liteasy_app` |
| 2 | `liteasy` | `liteasy_migrator` |
| 3 | `intuecho` | `intuecho_app` |
| 4 | `intuecho` | `intuecho_migrator` |
| 5 | `keycloak` | `keycloak_app` |

任何一条失败都停止。不要因为一个账号能连通，就推断其余四个账号也正确。

常见失败：

- 超时：VPC/交换机不同，或 RDS 白名单没有 ECS 私网 IP。
- 证书错误：CA 文件不对、权限不对，或数据库 URL 使用了 IP 而不是证书覆盖的 RDS 内网域名。
- 密码错误：账号密码不匹配；不要通过关闭 TLS 解决。

最后回到 RDS 控制台“数据库连接”页，确认没有公网连接地址；“白名单”中只存在 ECS 私网地址或经评审的同 VPC 运维地址，不得出现 `0.0.0.0/0`。

## 8. 创建对象存储和扫描服务

### 8.1 创建私有 OSS bucket

在 OSS 控制台创建 bucket：

- 地域：香港。
- 名称：唯一且包含 `staging`，例如 `liteasy-staging-hk-<随机后缀>`。
- 读写权限 ACL：私有。
- 版本控制：启用。
- 服务端加密：启用；本预发布不购买 KMS 时选择 OSS 托管的 `AES256` 加密。
- 静态网站托管：关闭。
- 公共访问：关闭。
- 生命周期：创建规则 `staging-compatibility-noncurrent-cleanup`，作用范围选择前缀 `compatibility/`；当前版本不要自动删除，非当前/历史版本保留 `7` 天后删除，并清理过期删除标记。保存后重新打开规则核对前缀，绝不能把规则作用到整个 bucket。

只创建专用于该 staging bucket 的 RAM 身份。不要使用阿里云主账号 AccessKey，也不要直接授予账号级 `AliyunOSSFullAccess`。所需最小权限必须覆盖 bucket 安全配置读取、版本状态读取，以及对象上传、分片上传、复制、元数据读取、下载、列举和删除。

### 8.2 OSS 安全适配仍是目标环境门禁

Liteasy 的 `LITEASY_S3_SECURITY_PROFILE=aliyun-oss` 会按阿里云 OSS 实际能力验证：bucket ACL 只有所有者、版本控制启用、随机对象确实被服务端加密、匿名读取/列举/写入均被拒绝，以及上传、复制、读取、元数据和删除数据面契约正常。它不会把 OSS 不支持的 AWS Public Access Block 或 Bucket Encryption 管理 API 当作必需调用。

因此：

1. 创建专用 bucket 和最小权限 RAM 凭据；不要使用主账号 AccessKey。
2. AccessKey ID 和 secret 只写入 `/etc/liteasy/staging/liteasy-api.env`，文件保持 `root:root 0600`，不要发送到聊天。
3. 确认该 env 中存在 `LITEASY_S3_SECURITY_PROFILE=aliyun-oss`。
4. 构建并拉取包含该适配器的新 Liteasy API 镜像后，执行第 11.2 节真实兼容性探针。
5. 探针未输出 `"verified":true` 时停止部署；不得删除或弱化 `assertSecurityConfiguration`。

### 8.3 部署仓库内的私有 PDF 扫描服务

阿里云“恶意文件检测”资源包和绑定的 `LiteasyStagingFileScannerRole` 不会自动生成 Liteasy 所需的私有同步 HTTPS URL，也不会给出可填入 `LITEASY_PDF_SCANNER_SECRET` 的共享密钥。它可以作为 OSS 侧的第二层异步检测，但不能替代上传事务中必须返回哈希绑定结论的扫描接口。

本仓库的 `deployment/staging/pdf-scanner/` 提供该接口：Node HTTPS 适配器把 PDF 流式发送给 ClamAV，不把文件写入宿主机；`clamd` 只在内部网络，只有 `freshclam` 拥有病毒库更新出口，所有容器都不发布宿主机端口。扫描器 secret 和私有 CA 由安装器在 ECS 上生成并写入 root-only 文件，不需要购买 KMS，也不需要人工编写或记忆。

当前 4 GiB ECS 先确认已启用第 6.4 节的 2 GiB swap；ClamAV 实际常驻内存接近 1 GiB，业务公开测试前仍必须把 ECS 升级到至少 8 GiB。先阅读本节，等第 10.5 节四个业务 env 和 `config.env` 都填写完成后，再回到仓库根目录执行：

```bash
cd /opt/liteasy/repository
sudo deployment/staging/pdf-scanner/install-runtime.sh
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  create
sudo docker compose \
  --project-directory deployment/staging/pdf-scanner \
  --file deployment/staging/pdf-scanner/compose.yaml \
  up --detach --build --wait clamav freshclam pdf-scanner
```

`create` 只创建尚未启动的业务容器和内部 `liteasy-staging_backend` 网络，不执行数据库迁移。安装器会把 `LITEASY_PDF_SCANNER_URL`、随机 secret 和独立 CA 组合包安全写入运行配置；重复执行会保留现有 CA 和 secret。

先运行完整验收：

```bash
sudo docker compose \
  --project-directory deployment/staging/pdf-scanner \
  --file deployment/staging/pdf-scanner/compose.yaml \
  --profile acceptance run --rm --no-deps scanner-verifier
```

命令输出必须包含一行结论 JSON，其中 `cleanPdf` 为 `accepted`、`eicarPdf` 为 `rejected`、`integrityMismatch` 和 `unauthorized` 均为 `rejected`，并包含 `scanner:"clamav"` 与真实版本；Compose 自身的容器创建提示可以忽略。

再验证 ClamAV 故障时失败关闭，并立即恢复服务：

```bash
sudo docker compose \
  --project-directory deployment/staging/pdf-scanner \
  --file deployment/staging/pdf-scanner/compose.yaml \
  stop clamav
sudo docker compose \
  --project-directory deployment/staging/pdf-scanner \
  --file deployment/staging/pdf-scanner/compose.yaml \
  --profile acceptance run --rm --no-deps scanner-verifier unavailable
sudo docker compose \
  --project-directory deployment/staging/pdf-scanner \
  --file deployment/staging/pdf-scanner/compose.yaml \
  up --detach --wait clamav pdf-scanner
```

不可用验收必须输出 `{"readiness":"unavailable","scan":"failed_closed"}`，恢复后再原样运行一次完整验收。任一步失败都停止上传测试；不要填假 URL、部署永远返回 clean 的服务，或临时关闭扫描检查。

## 9. 创建 ACR 并构建镜像

### 9.1 创建私有镜像仓库

在阿里云容器镜像服务 ACR 香港实例中：

1. 创建私有 namespace，例如 `liteasy`。
2. 创建四个私有仓库：
   - `liteasy-api`
   - `intuecho-api`
   - `identity-management`
   - `staging-gateway`
3. 记录 ACR 控制台给出的登录命令。
4. 不要开启匿名拉取。

如果 namespace 就叫 `liteasy`，下文的 `<acr>` 必须替换为完整前缀：

```text
registry.cn-hongkong.aliyuncs.com/liteasy
```

例如 `<acr>/liteasy-api:<git-sha>` 最终形如 `registry.cn-hongkong.aliyuncs.com/liteasy/liteasy-api:0123456789abcdef...`。`<git-sha>` 是同一次构建前 `git rev-parse HEAD` 的输出，不是任意版本名称。若你创建了其他 namespace，就使用 ACR 控制台显示的实际完整前缀。

Keycloak 使用已验证的 `26.3.2` registry digest。Caddy 基础镜像也必须使用评审后的官方 digest；不要只使用 tag。

### 9.2 在 CI 或受控构建机上构建

构建机必须检出一个已评审、无未提交变更的 Git SHA。不要在 2 vCPU、4 GiB ECS 上构建依赖。

```bash
git status --short
git rev-parse HEAD
```

`git status --short` 应没有输出。把 `git rev-parse HEAD` 的输出记作 `<git-sha>`。然后把 `<ACR用户名>` 替换为 ACR“访问凭证”页面显示的固定用户名；密码由 `docker login` 交互式询问：

构建镜像前先在同一 SHA 运行仓库门禁：

```bash
(cd products/liteasy/services/api && npm ci && npm test)
(cd products/intuecho && npm ci && npm test && npm run build)
(cd products/liteasy/apps/admin && npm ci && npm test && npm run build)
(cd platform/identity-service && npm test)
node --test deployment/staging/verify-config.test.mjs deployment/staging/templates.test.mjs
```

任一命令失败都停止构建和推送。不要用 Docker 构建成功替代单元测试与前端生产构建。

然后登录 ACR：

```bash
docker login --username=<ACR用户名> registry.cn-hongkong.aliyuncs.com
```

构建：

```bash
docker build \
  --provenance=false \
  --file products/liteasy/services/api/Dockerfile \
  --build-arg SOURCE_REVISION=<git-sha> \
  --build-arg SOURCE_VERSION=controlled-10-user-staging-<git-sha> \
  --tag <acr>/liteasy-api:<git-sha> \
  products/liteasy

docker build \
  --provenance=false \
  --file products/intuecho/services/api/Dockerfile \
  --build-arg SOURCE_REVISION=<git-sha> \
  --build-arg SOURCE_VERSION=controlled-10-user-staging-<git-sha> \
  --tag <acr>/intuecho-api:<git-sha> \
  products/intuecho

docker build \
  --provenance=false \
  --build-arg SOURCE_REVISION=<git-sha> \
  --build-arg SOURCE_VERSION=controlled-10-user-staging-<git-sha> \
  --tag <acr>/identity-management:<git-sha> \
  platform/identity-service

docker build \
  --provenance=false \
  --file deployment/staging/gateway.Dockerfile \
  --build-arg CADDY_IMAGE='<评审后的Caddy镜像>@sha256:<digest>' \
  --build-arg SOURCE_REVISION=<git-sha> \
  --build-arg SOURCE_VERSION=controlled-10-user-staging-<git-sha> \
  --build-arg VITE_INTUECHO_API_URL=https://community.staging.liteasyclaw.com \
  --build-arg VITE_LITEASY_CLOUD_URL=https://api.staging.liteasyclaw.com \
  --build-arg VITE_LITEASY_IDENTITY_URL=https://auth.staging.liteasyclaw.com/realms/liteasy \
  --tag <acr>/staging-gateway:<git-sha> \
  .
```

Liteasy API 必须以 `products/liteasy` 作为构建上下文，因为运行时还需要
`products/liteasy/packages/shared` 中的可视化 schema 和内置目录。构建后先验证镜像能完整加载服务模块：

```bash
docker run --rm --entrypoint node \
  <acr>/liteasy-api:<git-sha> \
  --input-type=module -e 'await import("./src/server.mjs"); console.log("server_import=ok")'
```

必须输出 `server_import=ok`。出现 `ENOENT` 或模块加载错误时停止，不要推送镜像。

在推送 gateway 前验证 Caddyfile，下面两个 CIDR 是文档测试地址，只用于解析配置：

```bash
docker run --rm \
  --entrypoint caddy \
  -e ACME_EMAIL=build-validation@example.invalid \
  -e MARKETING_HOST=staging.liteasyclaw.com \
  -e COMMUNITY_HOST=community.staging.liteasyclaw.com \
  -e ADMIN_HOST=admin.staging.liteasyclaw.com \
  -e API_HOST=api.staging.liteasyclaw.com \
  -e AUTH_HOST=auth.staging.liteasyclaw.com \
  -e IDENTITY_HOST=identity.staging.liteasyclaw.com \
  -e 'KEYCLOAK_ADMIN_ALLOWED_CIDRS=203.0.113.10/32 198.51.100.20/32' \
  <acr>/staging-gateway:<git-sha> \
  validate --config /etc/caddy/Caddyfile
```

必须输出 `Valid configuration` 或等价成功信息。若多 CIDR 解析失败，停止推送，不能把管理员白名单改成 `0.0.0.0/0`。

将四个镜像推送到 ACR：

```bash
docker push <acr>/liteasy-api:<git-sha>
docker push <acr>/intuecho-api:<git-sha>
docker push <acr>/identity-management:<git-sha>
docker push <acr>/staging-gateway:<git-sha>
```

推送后逐个读取 registry 返回的 digest：

```bash
docker inspect --format '{{join .RepoDigests "\n"}}' <acr>/liteasy-api:<git-sha>
docker inspect --format '{{join .RepoDigests "\n"}}' <acr>/intuecho-api:<git-sha>
docker inspect --format '{{join .RepoDigests "\n"}}' <acr>/identity-management:<git-sha>
docker inspect --format '{{join .RepoDigests "\n"}}' <acr>/staging-gateway:<git-sha>
```

每条至少应显示一个以对应 ACR 仓库开头的 `@sha256:...`。与 ACR 控制台镜像版本页交叉核对并记录完整引用。`deployment/staging/config.env` 中只能填写 digest 引用，不能填写 `latest` 或只有 tag 的引用。

### 9.3 在 ECS 登录 ACR

在 ECS 上执行控制台提供的登录命令，并让命令交互式询问密码：

```bash
sudo docker login --username=<ACR用户名> registry.cn-hongkong.aliyuncs.com
```

由于本手册使用 `sudo docker`，必须使用 `sudo docker login`；普通用户执行的登录不会自动提供给 root 的 Docker 客户端。

## 10. 准备运行配置和 root-only 密钥

### 10.1 创建文件

在 ECS 的仓库根目录执行：

```bash
cd /opt/liteasy/repository
test -f deployment/staging/templates/gateway.env.example && echo "template exists"
```

上一步应输出 `template exists`。下面的命令使用“文件不存在才复制”的条件；这样重复执行也不会覆盖已经填好的密码和白名单：

```bash
if [ ! -e deployment/staging/config.env ]; then
  cp deployment/staging/config.env.example deployment/staging/config.env
  chmod 0600 deployment/staging/config.env
fi

sudo install -d -o root -g root -m 0700 /etc/liteasy/staging
if [ ! -e /etc/liteasy/staging/gateway.env ]; then
  sudo install -o root -g root -m 0600 deployment/staging/templates/gateway.env.example /etc/liteasy/staging/gateway.env
fi
if [ ! -e /etc/liteasy/staging/keycloak.env ]; then
  sudo install -o root -g root -m 0600 deployment/staging/templates/keycloak.env.example /etc/liteasy/staging/keycloak.env
fi
if [ ! -e /etc/liteasy/staging/identity-management.env ]; then
  sudo install -o root -g root -m 0600 deployment/staging/templates/identity-management.env.example /etc/liteasy/staging/identity-management.env
fi
if [ ! -e /etc/liteasy/staging/liteasy-api.env ]; then
  sudo install -o root -g root -m 0600 deployment/staging/templates/liteasy-api.env.example /etc/liteasy/staging/liteasy-api.env
fi
if [ ! -e /etc/liteasy/staging/intuecho-api.env ]; then
  sudo install -o root -g root -m 0600 deployment/staging/templates/intuecho-api.env.example /etc/liteasy/staging/intuecho-api.env
fi
```

仓库内的 `deployment/staging/config.env` 已被 Git 忽略；`/etc/liteasy/staging` 位于仓库之外，本来就不会由 Git 跟踪。不要使用 `git add -f` 强行提交任何运行配置。

确认 gateway 运行文件已经创建：

```bash
sudo test -f /etc/liteasy/staging/gateway.env && echo "gateway.env exists"
```

应输出 `gateway.env exists`。如果没有输出或命令失败，确认你当前是在 ECS、位于仓库根目录，并重新执行上面的 `sudo install` 命令；不要在自己的 Windows 电脑上创建 `/etc/liteasy/staging`。

### 10.2 填写非密钥配置

编辑 `deployment/staging/config.env`：

```bash
nano deployment/staging/config.env
```

替换四个 ACR 镜像占位符为真实 `@sha256:...` 引用。Keycloak 已固定为验证过的 digest。保存后不要运行会把完整配置打印到聊天的命令。

编辑 gateway 配置：

```bash
sudoedit /etc/liteasy/staging/gateway.env
```

必须把以下两项都替换：

```dotenv
ACME_EMAIL=replace-with-monitored-certificate-email@example.invalid
KEYCLOAK_ADMIN_ALLOWED_CIDRS=replace-with-space-separated-operator-public-cidrs
```

`ACME_EMAIL` 改成确实能收信的证书运维邮箱；`KEYCLOAK_ADMIN_ALLOWED_CIDRS` 按第 5.5 节填写一个或多个空格分隔的公网 CIDR。保存 `nano` 或 `sudoedit` 时，通常依次按 `Ctrl+O`、回车、`Ctrl+X`。

### 10.3 不购买 KMS 时密钥从哪里来

本预发布明确不购买 KMS，这与四个 env 文件不冲突：env 文件既是容器的输入，也是当前权威副本。它们必须保持 `root:root 0600`，不得进入 Git、聊天、截图或普通备份。你不需要人工记忆随机值；需要查看或修改时只使用 `sudoedit`。服务器丢失时不能从记忆恢复，应在部署完成后把这些 env 和私有 CA/密钥做一份位于服务器之外的加密离线备份；没有加密备份就只能逐项轮换凭据。

各类值的来源如下：

| 类型 | 从哪里取得或如何设置 |
| --- | --- |
| 五个 RDS 密码 | 创建 `liteasy_app`、`liteasy_migrator`、`intuecho_app`、`intuecho_migrator`、`keycloak_app` 账号时在 RDS 控制台设置的密码；必须与控制台中的账号一一对应 |
| OSS AccessKey ID/secret | 阿里云 RAM 中专用于 `liteasy-staging-hk` 的身份创建 AccessKey 时获得；不是阿里云主账号密码 |
| Keycloak bootstrap 密码 | 本预发布新生成的独立随机值，只写在 `keycloak.env` |
| OIDC confidential client secrets | 本预发布新生成的独立随机值；按第 10.4 节把同一值填到 Keycloak 一侧和对应服务一侧 |
| PDF 扫描 secret | 不手工填写；第 8.3 节安装器自动生成并同步到 `pdf-scanner.env` 与 `liteasy-api.env` |
| SMTP 密码 | 邮箱或邮件服务商提供的 SMTP/应用专用密码；后续只在 Keycloak 管理页配置 |
| 模型和学术服务 API key | 对应服务商账号中创建；未购买或未审批就保持注释/空值 |

需要由本机新建的密码和 client secret 使用彼此不同的 64 位十六进制随机值；可在受控终端逐次执行 `openssl rand -hex 32`，立即粘贴到 `sudoedit` 打开的目标行。命令本身不会把随机结果写入 Shell 历史，但终端滚动区仍可能保留显示，填完后清屏并关闭会话。数据库 URL 使用这种十六进制值无需额外 URL 编码。不要使用姓名、邮箱、同一个“通用密码”或短句，也不要让多个独立 client 共用一个 secret。

本机文件方案的代价是没有集中审计、自动轮换和托管恢复。每次手工轮换必须同时更新所有配对行并滚动重启对应容器；生产环境应重新评估托管秘密服务或等价的专用秘密分发机制。

### 10.4 对应的 client secret 必须完全一致

以下左右两边必须填写完全相同的值：

| `keycloak.env` | 对应服务配置 |
| --- | --- |
| `LITEASY_CLOUD_CLIENT_SECRET` | `liteasy-api.env` 的 `LITEASY_IDP_CLIENT_SECRET` |
| `INTUECHO_API_CLIENT_SECRET` | `intuecho-api.env` 的 `INTUECHO_IDP_CLIENT_SECRET` |
| `LITEASY_IDENTITY_MANAGEMENT_CLIENT_SECRET` | `liteasy-api.env` 的 `LITEASY_IDP_MANAGEMENT_CLIENT_SECRET` |
| `LITEASY_IDENTITY_INTROSPECTION_CLIENT_SECRET` | `identity-management.env` 的 `IDENTITY_MANAGEMENT_INTROSPECTION_CLIENT_SECRET` |
| `LITEASY_IDENTITY_ADMIN_CLIENT_SECRET` | `identity-management.env` 的 `IDENTITY_MANAGEMENT_ADMIN_CLIENT_SECRET` |
| `INTUECHO_ORGANIZATION_SERVICE_SECRET` | `intuecho-api.env` 的 `INTUECHO_ORGANIZATION_SERVICE_CLIENT_SECRET` |
| `LITEASY_LITERATURE_SERVICE_CLIENT_SECRET` | `liteasy-api.env` 的 `LITEASY_IDP_LITERATURE_SERVICE_CLIENT_SECRET` |

`LITEASY_VISUALIZATION_SERVICE_CLIENT_SECRET` 也必须是独立随机值，供后续对应服务使用。

### 10.5 填写并检查五个运行文件

分别执行：

```bash
sudoedit /etc/liteasy/staging/keycloak.env
sudoedit /etc/liteasy/staging/identity-management.env
sudoedit /etc/liteasy/staging/liteasy-api.env
sudoedit /etc/liteasy/staging/intuecho-api.env
```

填写要求：

- 所有 RDS URL 使用内网域名。
- 应用账号与 migrator 账号必须不同。
- OSS bucket 必须是第 8 节创建的私有 staging bucket。
- `LITEASY_S3_SECURITY_PROFILE` 必须是 `aliyun-oss`。
- `LITEASY_PDF_SCANNER_URL` 和 `LITEASY_PDF_SCANNER_SECRET` 先保留占位符，再由第 8.3 节安装器自动替换；不要人工创造另一组扫描 secret。
- `LITEASY_RECOMMENDATION_CONTACT_EMAIL` 和 `LITEASY_RETRIEVAL_CONTACT_EMAIL` 都要替换成第 3 节记录的真实 `<RESEARCH_CONTACT_EMAIL>`；`operations@liteasyclaw.com` 并未在仓库中证明存在，不能自行假定。
- 不需要的模型密钥保持注释，不要填写假值。
- 不得删除 TLS、OIDC audience 或独立 client 的检查项。

检查文件所有权和权限：

```bash
sudo stat -c "%U %G %a %n" \
  /etc/liteasy/staging/*.env \
  /etc/liteasy/staging/aliyun-rds-ca.pem \
  /etc/liteasy/staging/liteasy-api-ca.pem
```

六个 env 文件（包括扫描器 env）应为 `root root 600`，两个 CA 文件应为 `root root 644`。`liteasy-api-ca.pem` 尚不存在时，说明第 8.3 节安装器还没有成功执行。

检查非注释配置行中是否还有占位符：

```bash
sudo grep -R -nE '^[[:space:]]*[A-Z][A-Z0-9_]*=.*replace-with' /etc/liteasy/staging
grep -nE '^[[:space:]]*[A-Z][A-Z0-9_]*=.*replace-with' deployment/staging/config.env
```

两条命令都应没有输出。被 `#` 注释掉的可选模型示例不会被匹配；任何未注释的输出都表示仍有假值，必须停止，不要启动容器。

## 11. 部署前检查和首次启动

### 11.1 分别在构建机和 ECS 检查配置

下面两条 Node 命令由代码维护者在装有 Node.js 20+ 的构建机/CI 仓库根目录执行。构建机应使用与 ECS 相同的非密钥 `deployment/staging/config.env`；第 6.2 节没有在 ECS 安装 Node.js，所以不要在 ECS 直接照抄这两条命令：

```bash
node deployment/staging/verify-config.mjs deployment/staging/config.env
node --test deployment/staging/verify-config.test.mjs deployment/staging/templates.test.mjs
```

第一条应输出包含 `"verified":true` 的 JSON，第二条测试必须全部通过。若你没有这台构建机，应把这一步交给仓库维护者，而不是从未知网站安装 Node。

随后在 ECS 仓库根目录只做 Compose 静态检查：

```bash
cd /opt/liteasy/repository
git rev-parse HEAD
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  config --quiet
```

成功时没有输出且退出码为 0。不要省略 `--quiet` 后把完整 Compose 配置复制到聊天或日志，因为展开后的配置可能包含敏感环境值。

### 11.2 拉取镜像并执行 OSS 兼容性探针

先拉取镜像：

```bash
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  pull
```

然后执行探针，把 `<staging-bucket-name>` 替换为真实 bucket 名：

```bash
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  run --rm --no-deps \
  -e LITEASY_STAGING_S3_CONFIRM=verify:<staging-bucket-name> \
  liteasy-maintenance npm run verify:staging-s3
```

只有输出中明确包含 `"verified":true` 才能继续。探针会创建并删除随机 PDF 对象，不会输出密钥。失败时保存不含密钥的错误类型，停止部署 Liteasy，不要反复修改安全检查。

### 11.3 执行数据库迁移

操作位置：先在阿里云 RDS 控制台创建恢复点，再回到 ECS 执行迁移和权限检查。

**迁移前不能跳过手工备份：**

1. 打开目标 RDS 实例，进入“备份恢复 -> 数据备份”。
2. 点击“创建备份”。选择备份整个实例/全部数据库，不要只导出某一张表。
3. 备注填写待发布的完整 `<git-sha>` 和变更单号，不要填写密码。
4. 提交后留在备份任务列表，直到状态显示“成功”。记录备份任务 ID、开始时间、完成时间和当时的最晚可恢复时间。
5. 如果状态为失败、备份一直未完成或 PITR 可恢复时间没有继续推进，停止迁移并先解决 RDS 备份问题。

第一次空库部署也必须执行这一步，它同时验证你的账号确实有创建备份和查看结果的权限。后续每次发布同样执行。

回到 ECS，先确认当前仓库提交：

```bash
cd /opt/liteasy/repository
git rev-parse HEAD
git status --short
```

SHA 必须等于镜像构建记录中的 `<git-sha>`，状态命令必须没有输出。然后按顺序执行，任意一步失败都应停止：

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

迁移成功会输出一行 JSON，例如 `{"applied":["001_....sql"]}`；首次执行会列出当前 SHA 中的全部迁移，后续执行只列出新增迁移。出现 `migration_changed`、`migration_unknown`、权限错误或非零退出码都必须停止。迁移账号会创建表并向应用账号授予有限运行权限，不要改用应用账号执行迁移。

立即原样重复上面两条迁移命令。第二次输出必须是 `{"applied":[]}`，证明相同 SHA 的迁移可以幂等复跑；若仍有迁移被应用或 checksum 报错，停止。

然后分别以两个应用账号检查迁移记录不可写、不能在 `public` schema 建表。密码仍由 `psql -W` 交互询问：

```bash
psql "host=<RDS_INTERNAL_HOST> port=5432 dbname=liteasy user=liteasy_app sslmode=verify-full sslrootcert=/etc/liteasy/staging/aliyun-rds-ca.pem" -W -c "select count(*) as migration_count from schema_migrations; select has_schema_privilege(current_user, 'public', 'CREATE') as can_create_in_public, has_table_privilege(current_user, 'schema_migrations', 'INSERT') as can_insert_migration, has_table_privilege(current_user, 'schema_migrations', 'UPDATE') as can_update_migration, has_table_privilege(current_user, 'schema_migrations', 'DELETE') as can_delete_migration;"

psql "host=<RDS_INTERNAL_HOST> port=5432 dbname=intuecho user=intuecho_app sslmode=verify-full sslrootcert=/etc/liteasy/staging/aliyun-rds-ca.pem" -W -c "select count(*) as migration_count from schema_migrations; select has_schema_privilege(current_user, 'public', 'CREATE') as can_create_in_public, has_table_privilege(current_user, 'schema_migrations', 'INSERT') as can_insert_migration, has_table_privilege(current_user, 'schema_migrations', 'UPDATE') as can_update_migration, has_table_privilege(current_user, 'schema_migrations', 'DELETE') as can_delete_migration;"
```

两个查询的 `migration_count` 都必须大于 `0`，后四列必须全部为 `f`。如果 `can_create_in_public` 为 `t`，由 RDS 高权限运维账号在对应数据库执行 `REVOKE CREATE ON SCHEMA public FROM PUBLIC;`，再重跑检查；如果任一迁移写权限为 `t`，不要手工继续授权或启动服务，先修正迁移程序并重新执行迁移任务。

### 11.4 启动所有服务

```bash
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  up --detach
```

查看状态：

```bash
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  ps
```

预期 `gateway`、`keycloak`、`identity-management`、`liteasy-api`、`intuecho-api` 最终都显示运行中；带 healthcheck 的服务应显示 `healthy`。Keycloak 第一次初始化可能需要几十秒。

确认 gateway 的本地 Docker 日志轮转设置已经生效：

```bash
gateway_container="$(sudo docker compose --env-file deployment/staging/config.env --file deployment/staging/compose.yaml ps -q gateway)"
sudo docker inspect "$gateway_container" \
  --format '{{.HostConfig.LogConfig.Type}} {{index .HostConfig.LogConfig.Config "max-size"}} {{index .HostConfig.LogConfig.Config "max-file"}}'
```

必须输出 `json-file 10m 5`。为空或不同就停止，并确认 ECS 检出的 `compose.yaml` 是本手册对应的评审 SHA。

查看某一个服务的最近日志：

```bash
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  logs --tail 200 keycloak
```

把最后的服务名替换为 `gateway`、`liteasy-api`、`intuecho-api` 或 `identity-management`。不要使用 `env`、`inspect` 或不带筛选的配置输出收集故障信息，以免泄露密钥。

#### 11.4.1 切换文本模型到 DeepSeek

迁移 `032_deepseek_text_provider.sql` 只负责把默认文本策略和结构化可视化路由切到 DeepSeek，并复制该路由已有的版本化计费策略；它不会创建或猜测 DeepSeek API Key。完成以下全部步骤后才算切换成功：

1. 从已评审提交构建并推送新的 `liteasy-api` 镜像和包含管理端的新 `gateway` 镜像，把仓库 digest 写入 `deployment/staging/config.env`。桌面端默认模型也已改为 `deepseek-chat`，对外发版时需要另行生成并验收新的桌面安装包。
2. 在 root-only `/etc/liteasy/staging/liteasy-api.env` 中设置 `LITEASY_VISUALIZATION_EGRESS_HOSTNAMES=api.deepseek.com,vip.auto-code.net`。这里仅填写主机名，不填写任何 API Key。
3. 执行第 11.3 节 Liteasy 迁移并确认第二次运行输出 `{"applied":[]}`，再启动新容器。迁移完成而 DeepSeek Key 尚未保存的短暂窗口内，文本和结构化生成应失败关闭；不要把这种 503 当作部署完成。
4. 用具名 `platform_admin` 账号和新鲜 MFA 打开管理端“模型服务”。文本 API 地址保持 `https://api.deepseek.com`，文本模型保持 `deepseek-chat`，由操作者直接填写 DeepSeek Key。已有视觉和 MinerU 配置时，将视觉地址、视觉模型、视觉 Key、MinerU Token 留空以保留旧值；首次配置则必须完整填写三类凭据。
5. 验证薄读、AI 助手、翻译、Agent 和结构化可视化都走 DeepSeek；验证 MinerU 图片理解仍使用 `gpt-5.6-sol`，图片生成仍使用 `gpt-image-2`。同时检查日志只含稳定错误和元数据，不含 prompt、Key 或上游错误正文。

DeepSeek Key、现有视觉/图片 Key 和 MinerU Token 是三类独立秘密。不得通过聊天传递，不得写入 Git、命令行参数或 shell 历史；只能由授权操作者在管理端密码框中录入，并保存在批准的加密离线备份中。

### 11.5 Caddy 如何申请和续期公网证书

你不需要在阿里云购买或上传 SSL 证书，也不需要安装 Certbot 或编写续期定时任务。本仓库的 gateway 镜像已经包含 Caddy 和六个域名的站点配置。首次启动 gateway 后，Caddy 会自动执行以下过程：

1. 读取 `gateway.env` 中的域名和 `ACME_EMAIL`。
2. 向公网证书颁发机构发起 ACME 申请。
3. 证书机构通过 DNS 解析到 `8.217.186.73`，再从公网访问 TCP `80` 或 `443` 验证域名。
4. Caddy 把证书、私钥和 ACME 账号状态保存在 Docker 命名卷 `caddy-data`，不会写进 Git。
5. Caddy 在证书到期前自动续期；只要 gateway 持续运行、DNS 不变且公网仍能访问 TCP `80/443`，无需人工操作。

因此，申请成功必须同时满足：六个 A 记录都已生效，安全组允许 TCP `80/443`，启用状态的 UFW 也允许这两个端口，`ACME_EMAIL` 已替换成真实邮箱，服务器时间正确，并且没有其他程序占用 `80/443`。检查时间：

```bash
timedatectl status
```

输出中的 `System clock synchronized` 应为 `yes`。然后查看 gateway 日志：

```bash
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  logs --tail 300 gateway
```

首次签发可能需要几十秒。日志中应出现成功取得证书的记录，并且不应持续重复 `challenge failed`、`no such host`、`timeout` 或频率限制错误。不要因为一次失败就快速反复重建 gateway；先按第 13 节排查 DNS 和端口，以免触发证书机构的申请频率限制。

检查证书数据卷仍然存在：

```bash
sudo docker volume ls --filter name=liteasy-staging_caddy-data
```

应看到 `liteasy-staging_caddy-data`。普通的 `docker compose down` 不会删除它，但绝不能执行 `docker compose down --volumes` 或手工删除该卷。也不要把卷中的私钥复制到聊天、Git 或工单。

### 11.6 验证公网端口、HTTPS 和健康状态

先在 ECS 上确认 Docker 没有发布内部端口：

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

只有 gateway 可以出现 `0.0.0.0:80->80/tcp`、`0.0.0.0:443->443/tcp` 和 `0.0.0.0:443->443/udp` 之类的主机映射。其他容器即使显示 `8080/tcp` 或 `9000/tcp`，只要前面没有 `0.0.0.0:` 或 `[::]:`，就没有发布到主机公网。若其他容器出现公网映射，应立即停止并修正 Compose。

在自己的 Windows PowerShell 中验证安全组和监听端口：

```powershell
80, 443 | ForEach-Object {
  "TCP $_ = " + (Test-NetConnection 8.217.186.73 -Port $_ -InformationLevel Quiet)
}
4040, 8080, 8787, 9000, 9090, 5432 | ForEach-Object {
  "TCP $_ = " + (Test-NetConnection 8.217.186.73 -Port $_ -InformationLevel Quiet)
}
```

启动完成后，`80` 和 `443` 应为 `True`；`4040`、`8080`、`8787`、`9000`、`9090`、`5432` 必须全部为 `False`。TCP `22` 只应在你的白名单网络中为 `True`。如果内部端口出现 `True`，不要继续，先检查 ECS 绑定的所有安全组和 `docker ps` 输出。

以上只检查 ECS 公网 IP。另回到 RDS 控制台的“数据库连接”页面，确认只有内网地址，未申请或已释放公网地址；RDS 白名单中也不得出现 `0.0.0.0/0`。

继续在自己的 Windows 电脑执行：

```powershell
curl.exe --fail --head https://staging.liteasyclaw.com
curl.exe --fail --head https://community.staging.liteasyclaw.com
curl.exe --fail --head https://admin.staging.liteasyclaw.com
curl.exe --fail https://api.staging.liteasyclaw.com/healthz
curl.exe --fail https://api.staging.liteasyclaw.com/readyz
curl.exe --fail https://community.staging.liteasyclaw.com/healthz
curl.exe --fail https://community.staging.liteasyclaw.com/readyz
curl.exe --fail https://auth.staging.liteasyclaw.com/realms/liteasy/.well-known/openid-configuration
```

成功判据：

- 三个网页返回 HTTP `200` 或合理的 `3xx` 跳转。
- `healthz` 成功表示进程存活。
- `readyz` 成功表示当前依赖检查通过，但不代表完整业务已经验收。
- Keycloak discovery 返回 JSON，`issuer` 应为 `https://auth.staging.liteasyclaw.com/realms/liteasy`。
- 浏览器地址栏证书有效，域名匹配且没有安全警告。

在浏览器中分别打开六个域名并查看地址栏的证书信息。证书覆盖的域名必须与当前访问域名相同，当前时间处于有效期内；不要点击浏览器的“仍然继续”绕过证书警告。

外网访问 `https://identity.staging.liteasyclaw.com/readyz` 应返回 `404`，这是预期行为，不是健康检查失败。

### 11.7 验证公网管理入口并配置 Keycloak

从任意允许访问 HTTPS 的网络打开：

```text
https://auth.staging.liteasyclaw.com/admin/
```

使用 `keycloak.env` 中的 bootstrap 管理员登录。该凭据只属于 Keycloak 基础设施，不是产品用户。

先验证公网管理入口：

1. 在 Windows 执行 `curl.exe -I https://auth.staging.liteasyclaw.com/admin/`，应得到 Keycloak 的 `2xx/3xx` 或登录跳转，不应是 Gateway 的 `404`。
2. 手机关闭 Wi-Fi、只使用移动网络后访问同一地址，也应得到 Keycloak 的 `2xx/3xx` 或登录跳转。
3. 手机移动网络访问 `https://auth.staging.liteasyclaw.com/realms/liteasy/.well-known/openid-configuration` 应仍能看到 JSON。
4. 从公网访问 `https://identity.staging.liteasyclaw.com/readyz` 仍应得到 `404`；identity-management 没有公网管理页面。

如果前两步仍是 `404`，检查 gateway 是否已使用最新镜像并重建。不要开放 `8080`。

必须完成：

1. 选择 `liteasy` realm。
2. 进入 `Realm settings -> Email`，填写真实 SMTP 主机、端口、发件人和加密方式。SMTP 密码使用邮箱或邮件服务商提供的应用专用密码，由授权运维人员直接填入 Keycloak 页面，并在服务器外的加密离线备份中保存；不要发送到聊天。然后点击测试连接/发送测试邮件，测试邮件未收到就停止。
3. 进入 `Realm settings -> Login` 打开 `Verify email`；再到 `Authentication -> Required actions` 确认 `Verify Email` 已启用。用一个新测试账号完成邮箱验证。
4. 在 `Authentication -> Policies` 配置组织认可的 OTP 策略，并在 `Required actions` 启用 `Configure OTP`，但**不得设为默认动作**。普通桌面端和论坛客户端绑定 `liteasy-user-browser`，只使用 SSO Cookie 或密码，不要求 OTP；只有 `liteasy-admin-public` 绑定 `liteasy-admin-browser`，每次管理端认证都要求密码和 OTP。为每个被授予 `platform_admin` 的账号单独加入 `Configure OTP`，让本人完成注册后再进入管理端。仅在界面中打开开关但未实际登录不算验收。
5. 启用并实际测试忘记密码、恢复代码或组织选定的账号恢复流程，确认恢复过程不会绕过 MFA。
6. 为每一位实际运维人员分别创建具名、可审计的长期 Keycloak 管理员，只授予所需 realm 管理权限，并强制该账号使用 MFA；需要多个管理员就重复这一步，不要多人共用一个管理员用户名。
7. 在另一个浏览器会话验证长期管理员可以完成所需管理操作后，移除或禁用临时 bootstrap 管理员。

为每位长期管理员执行同一套独立操作：

1. `Users -> Create new user`，填写个人用户名和真实个人邮箱，不使用 `admin2`、共享邮箱或同一用户名。
2. 保存后进入 `Credentials`，设置一次性临时密码并启用“Temporary”，让本人首次登录强制改密；密码通过组织认可的秘密渠道交付，不放进部署记录。
3. 在该用户的 `Required user actions` 加入 `Configure OTP` 和 `Update Password`；如果邮箱尚未验证，再加入 `Verify Email`。
4. 进入 `Role mapping -> Assign role -> Filter by clients`，从 `realm-management` 分配实际工作所需角色。只管理用户时使用用户查询/查看/管理角色；只有负责 realm 安全策略、SMTP 或 client 配置的人才增加对应 realm/client 管理角色。初始建设若临时授予 `realm-admin`，完成设置后必须收回并改为日常最小角色。
5. 让本人从其白名单网络登录 `/admin/`，完成改密和 OTP 绑定，再退出并重新登录一次。
6. 由另一位管理员确认该账号能完成职责内操作、不能完成职责外操作，并在 Keycloak 管理事件中能区分具体用户名。

每增加一个管理员，都要继续执行具名账号、最小 realm-management 角色和 MFA 验收；公网入口本身不授予任何平台权限。

注意：`--import-realm` 对已存在的 realm 使用忽略策略。修改仓库中的 realm JSON 后重启，不会自动更新已经存入 RDS 的 realm；后续变更必须通过受审的 Keycloak 管理操作或专门迁移完成。

### 11.8 创建产品平台管理员

先通过真实预发布注册流程创建个人用户。在 Keycloak 管理页选择 `liteasy` realm，进入 `Users`，搜索并打开该用户；详情页显示的用户 ID（通常是 UUID，浏览器地址中也会出现）就是 IdP subject。核对邮箱和用户名后只记录这个非秘密 ID，不要复制 access token。然后在 ECS 仓库根目录只执行一次：

```bash
cd /opt/liteasy/repository
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  run --rm --no-deps \
  -e 'LITEASY_BOOTSTRAP_ADMIN_SUBJECT=<真实IdP subject>' \
  -e 'LITEASY_BOOTSTRAP_REASON=<审批原因>' \
  -e LITEASY_BOOTSTRAP_CONFIRM=bootstrap-first-platform-admin \
  liteasy-maintenance npm run bootstrap:admin
```

运行前去掉尖括号并替换为真实 subject 和至少 8 字符的审批原因。不要使用 Keycloak bootstrap 管理员作为产品平台管理员。执行后还要验证管理端 token 的 audience 为 `liteasy-admin`，并验证 MFA 新鲜度门禁。

### 11.9 安装并验证每日维护任务

操作位置：ECS。只有第 11.2 节 OSS 探针、真实 PDF 扫描服务和第 11.6 节 readiness 都通过后才执行。

维护任务会处理未完成的 PDF 安全扫描和存储清理。它不是可选命令；长期不运行会留下暂存对象、过期数据或未完成扫描。先安装仓库提供的脚本和 systemd 单元：

```bash
cd /opt/liteasy/repository
sudo install -o root -g root -m 0755 \
  deployment/staging/scripts/run-maintenance.sh \
  /usr/local/sbin/liteasy-staging-maintenance
sudo install -o root -g root -m 0644 \
  deployment/staging/systemd/liteasy-staging-maintenance.service \
  /etc/systemd/system/liteasy-staging-maintenance.service
sudo install -o root -g root -m 0644 \
  deployment/staging/systemd/liteasy-staging-maintenance.timer \
  /etc/systemd/system/liteasy-staging-maintenance.timer
sudo systemd-analyze verify \
  /etc/systemd/system/liteasy-staging-maintenance.service \
  /etc/systemd/system/liteasy-staging-maintenance.timer
sudo systemctl daemon-reload
```

`systemd-analyze verify` 没有输出错误才算通过。先手工运行一次，不要先启用定时器：

```bash
sudo systemctl start liteasy-staging-maintenance.service
sudo systemctl show liteasy-staging-maintenance.service \
  --property=Result --property=ExecMainStatus
sudo journalctl -u liteasy-staging-maintenance.service --since "30 minutes ago" --no-pager
```

成功判据：`Result=success`、`ExecMainStatus=0`，日志中的 JSON 不包含 failures，且末尾能看到 `liteasy-maintenance` 的 `result=success`。如果任务失败、仍有未扫描对象或提示存储维护不完整，停止，不得启用定时器。

手工验证通过后启用每日定时器：

```bash
sudo systemctl enable --now liteasy-staging-maintenance.timer
sudo systemctl list-timers liteasy-staging-maintenance.timer --all
```

预期 `NEXT` 有下一次时间，`UNIT` 为 `liteasy-staging-maintenance.timer`。任务按北京时间每天 `03:20` 运行，并在服务器错过时间后补跑。`RandomizedDelaySec=15m` 表示实际启动可能延后最多 15 分钟。第 11.10 节必须为 `result=failure` 配置告警，否则只有定时执行而没有人知道失败。

### 11.10 配置阿里云监控、集中日志和真实告警

操作位置：阿里云控制台；最后一步在 ECS 发送一条带 `test=true` 的测试日志。

先建立联系人，后建规则：

1. 打开“云监控 -> 告警服务 -> 告警联系人”，为每位实际值班人员创建自己的联系人并完成邮箱/手机验证。
2. 创建联系人组 `liteasy-staging-operators`，把至少两位能处理故障的人加入。只有一人时也可以开始预发布，但必须记录无人值守时段。
3. 使用“应用分组”创建 `liteasy-staging-hk`，加入 ECS、RDS、EIP 和 OSS bucket。不要把生产资源混入该组。

在“主机监控”中选择目标 ECS。若页面提示监控插件/云监控 agent 未安装，点击“安装插件”，按控制台为中国香港生成的命令安装；等待实例状态变为“正常/在线”再继续。不要从第三方网站复制 agent 安装脚本。

为 ECS 创建下列告警规则，通知组都选 `liteasy-staging-operators`：

| 指标 | 条件 | 连续次数 | 严重性 |
| --- | --- | --- | --- |
| CPU 使用率 | `>= 85%`，周期 5 分钟 | 3 | 警告 |
| 内存使用率 | `>= 85%`，周期 5 分钟 | 3 | 警告 |
| 根磁盘使用率 | `>= 80%`，周期 5 分钟 | 2 | 警告 |
| 根磁盘使用率 | `>= 90%`，周期 1 分钟 | 1 | 严重 |
| 实例状态 | 不可用/停止 | 1 | 严重 |
| 公网出带宽 | 接近已购上限的 `80%` | 3 | 警告 |

为 RDS 至少创建 CPU、内存、存储使用率、连接数达到上限 `80%`、磁盘空间低于 `20%`、备份失败和主备切换告警。为 OSS 创建 4xx/5xx 请求异常和流量突增告警；具体基线应在一周真实测试数据后调整，首次不能关闭告警来减少通知。

然后在“云监控 -> 可用性监控/站点监控”分别创建 HTTPS `GET` 探测，频率 5 分钟，连续失败 2 次告警：

```text
https://staging.liteasyclaw.com/
https://community.staging.liteasyclaw.com/healthz
https://api.staging.liteasyclaw.com/healthz
https://auth.staging.liteasyclaw.com/realms/liteasy/.well-known/openid-configuration
```

前三个预期 HTTP `200`；Keycloak discovery 预期 `200` 且响应正文包含 `https://auth.staging.liteasyclaw.com/realms/liteasy`。不要从公网监控 `identity.staging...`，因为它按设计返回 `404`；不要监控 `/admin`，因为来源 IP 白名单会使探测失败。

集中日志使用日志服务 SLS：

1. 在中国香港地域创建 Project `liteasy-staging-hk` 和 Logstore `runtime`，预发布保留期先设 `30` 天，开启全文索引。日志中不得写入 env、token、密码或 PDF 正文。
2. 在 SLS 的“机器组/接入数据”中选择 ECS Linux，使用控制台为当前账号和地域生成的 LoongCollector 安装命令。在 ECS 执行后，回到页面等待机器心跳显示在线。该安装命令含账号和地域参数，本文不能替你编造。
3. 新建“Docker 标准输出”采集配置，只采集 Docker label `com.docker.compose.project=liteasy-staging` 的容器，发送到 `runtime` Logstore。不要采集容器环境变量或 `docker inspect` 输出。
4. 再新建文本日志采集，采集 `/var/log/syslog`，用于接收第 11.9 节脚本通过 `logger` 写入的维护结果。
5. 在 SLS 告警中心建立查询 `liteasy-maintenance AND result=failure`，检查周期 5 分钟，命中 1 条即通知 `liteasy-staging-operators`。

在 ECS 发送一条明确标记为测试的失败日志：

```bash
logger -p local0.err -t liteasy-maintenance "result=failure test=true"
```

在 SLS 中应能检索到 `test=true`，并且联系人实际收到告警。测试完成后将该告警标记为演练，不要删除真实规则。任何联系人未收到通知、LoongCollector 离线或站点监控未启用时，最终门禁都不通过。

### 11.11 执行一次隔离的 RDS 时间点恢复演练

操作位置：阿里云 RDS 控制台和 ECS。该操作会额外创建一个临时 RDS 实例并产生费用；不得把恢复结果直接覆盖在线实例。

只有“控制台显示已开启 PITR”还不够，必须实际恢复一次：

1. 在部署记录中写下演练开始时间、源 RDS 实例 ID、当前应用 Git SHA，以及 Liteasy/Intuecho 两个 `schema_migrations` 的行数。
2. 打开源 RDS 的“备份恢复”，选择“按时间点恢复/恢复到新实例”。恢复点选择当前可恢复范围内、并且晚于首次成功迁移的一个明确时间。
3. 目标地域、VPC、PostgreSQL 主版本与源实例保持一致；实例名称加 `restore-drill`。不要申请公网地址。
4. 创建后只把 ECS 私网 IP 加入临时实例白名单。记录临时 RDS 内网地址 `<RESTORED_RDS_INTERNAL_HOST>`。
5. 等待实例状态为“运行中”，恢复任务状态为“成功”。失败或只创建了空实例时停止并联系阿里云支持。

在 ECS 上使用与 root-only env 对应的原有账号密码，通过 `psql -W` 只读检查恢复实例；不要修改 `/etc/liteasy/staging/*.env`，也不要让在线容器连接临时实例：

```bash
psql "host=<RESTORED_RDS_INTERNAL_HOST> port=5432 dbname=liteasy user=liteasy_app sslmode=verify-full sslrootcert=/etc/liteasy/staging/aliyun-rds-ca.pem" -W -c "select count(*) as migration_count from schema_migrations; select count(*) as table_count from pg_tables where schemaname = 'public';"

psql "host=<RESTORED_RDS_INTERNAL_HOST> port=5432 dbname=intuecho user=intuecho_app sslmode=verify-full sslrootcert=/etc/liteasy/staging/aliyun-rds-ca.pem" -W -c "select count(*) as migration_count from schema_migrations; select count(*) as table_count from pg_tables where schemaname = 'public';"

psql "host=<RESTORED_RDS_INTERNAL_HOST> port=5432 dbname=keycloak user=keycloak_app sslmode=verify-full sslrootcert=/etc/liteasy/staging/aliyun-rds-ca.pem" -W -c "select count(*) as realm_count from realm; select count(*) as user_count from user_entity;"
```

三个数据库都必须存在；两个产品库的迁移数应与所选恢复点一致；Keycloak 至少存在 `liteasy` realm。再抽样比较不含正文和秘密的业务计数、审计计数和恢复点前后的预期差异。记录实际恢复耗时和数据截止点。

数据库恢复验证完成后，从 RDS 控制台释放临时实例前，先保存去敏结果和任务 ID。确认没有任何在线 env 指向临时地址，再释放临时实例，避免持续计费。

这一步只证明 RDS PITR。完整恢复还必须把数据库引用的 PDF 对象恢复到**独立的恢复 bucket**，验证版本、大小和 SHA-256，再按 [Liteasy 存储备份与恢复运行手册](../../docs/operations/Liteasy-存储备份与恢复运行手册.md) 对账。当前 OSS S3 兼容性和对象恢复流程尚未获得真实证据，因此在那部分完成前，不能把本节写成“完整灾难恢复已通过”。

### 11.12 后续版本如何更新部署

操作位置：先在构建机完成评审、测试、构建和推送，再在 ECS 更新。不要在 ECS 上直接跟随 `main`，也不要用 `latest`。

构建机对新完整 SHA 重复第 9.2 节，得到四个新 ACR digest，并保存测试结果。数据库迁移、Keycloak realm 或配置模板有变化时必须在变更记录中单独指出。

在 ECS 先保存当前可回退信息。`config.env` 不含密码，但仍按仅 root 可读保存：

```bash
cd /opt/liteasy/repository
release_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -o root -g root -m 0700 /var/lib/liteasy-staging/releases
sudo install -o root -g root -m 0600 \
  deployment/staging/config.env \
  "/var/lib/liteasy-staging/releases/${release_stamp}.config.env"
git rev-parse HEAD | sudo tee "/var/lib/liteasy-staging/releases/${release_stamp}.git-sha" >/dev/null
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  images --format json | sudo tee "/var/lib/liteasy-staging/releases/${release_stamp}.images.json" >/dev/null
```

确认三个记录文件存在后，检出维护者提供的新 SHA：

```bash
git fetch --prune origin
git cat-file -e <new-git-sha>^{commit}
git checkout --detach <new-git-sha>
git rev-parse HEAD
git status --short
```

`git rev-parse HEAD` 必须等于 `<new-git-sha>`，状态必须为空。编辑 `deployment/staging/config.env`，把四个应用镜像改成该 SHA 构建后记录的 ACR digest；不要修改 `/etc/liteasy/staging/*.env`，除非本次发布明确包含经过审批的配置或 secret 轮换。

然后依次执行：

1. 在构建机运行第 11.1 节的 Node 配置校验和测试。
2. 在 ECS 执行 Compose `config --quiet`。
3. 按第 11.3 节创建并等待 RDS 手工备份成功。
4. 执行 `pull` 和第 11.2 节 OSS 兼容性探针。
5. 按第 11.3 节运行两个迁移任务并复跑到 `{"applied":[]}`。
6. 启动新版本并重新安装可能更新的维护脚本/systemd 单元。

对应 ECS 命令如下：

```bash
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  config --quiet
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  pull

sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  run --rm --no-deps \
  -e LITEASY_STAGING_S3_CONFIRM=verify:<staging-bucket-name> \
  liteasy-maintenance npm run verify:staging-s3

sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  --profile migration run --rm liteasy-migrate
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  --profile migration run --rm intuecho-migrate

# 再原样执行上面两个迁移命令，确认两次都输出 {"applied":[]}。

sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  up --detach --remove-orphans
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  ps

sudo install -o root -g root -m 0755 \
  deployment/staging/scripts/run-maintenance.sh \
  /usr/local/sbin/liteasy-staging-maintenance
sudo install -o root -g root -m 0644 \
  deployment/staging/systemd/liteasy-staging-maintenance.service \
  /etc/systemd/system/liteasy-staging-maintenance.service
sudo install -o root -g root -m 0644 \
  deployment/staging/systemd/liteasy-staging-maintenance.timer \
  /etc/systemd/system/liteasy-staging-maintenance.timer
sudo systemctl daemon-reload
sudo systemctl restart liteasy-staging-maintenance.timer
```

最后完整重复第 11.5～11.10 节的证书、端口、健康、登录、维护和告警检查，并用真实测试账号走一次桌面、论坛和管理端关键路径。验证失败时不要删除旧记录文件，按第 14 节判断是否允许应用回滚。

## 12. Windows 客户端和网站下载

当前状态：**受控 staging 已能通过体验申请后的短时令牌下载 `0.1.12`，但仍不能提升为生产或不受控公开下载。** 当前没有组织 Authenticode 证书和签名服务，也没有完成干净 Windows 11 环境的签名安装 E2E。下面把已能执行的构建步骤、当前受控例外和必须停止的位置分开写清楚。

### 12.1 准备受控 Windows 构建机

操作位置：不存放个人资料的 Windows 11 x64 构建机，不是 ECS。

安装并验证：

1. Git for Windows。
2. Node.js 22 LTS x64 和随附 npm。
3. Rust stable 的 `x86_64-pc-windows-msvc` toolchain。
4. Visual Studio 2022 Build Tools，勾选“使用 C++ 的桌面开发”和 Windows 11 SDK。
5. Microsoft Edge WebView2 Runtime。
6. Windows SDK 中的 `signtool.exe`；只有第 12.3 节真实签名时才使用。

在 PowerShell 执行：

```powershell
git --version
node --version
npm --version
rustc --version
cargo --version
```

五条都应显示版本，Node 主版本应为 `22`。缺少任一工具就停止，不要从非官方网站下载“整合环境”。

### 12.2 检出同一 SHA、测试并构建

Windows 构建机必须通过自己的只读仓库权限检出和 ECS、ACR 镜像相同的完整 `<git-sha>`。在仓库根目录执行：

```powershell
git fetch --prune origin
git checkout --detach <git-sha>
git rev-parse HEAD
git status --short
Set-Location products/liteasy/apps/desktop
$env:VITE_LITEASY_CLOUD_URL="https://api.staging.liteasyclaw.com"
$env:VITE_FORUM_API_URL="https://community.staging.liteasyclaw.com"
$env:VITE_FORUM_WEB_URL="https://community.staging.liteasyclaw.com"
npm ci
npm test
npm run build
npm run tauri build
```

`git rev-parse HEAD` 必须等于 `<git-sha>`，`git status --short` 在构建前必须为空，三个 npm 命令都必须退出为 `0`。构建失败时停止发布，不要分发旧的或未签名的 `target/release/bundle` 文件。

查找 NSIS 安装包：

```powershell
$installer = Get-ChildItem .\src-tauri\target\release\bundle\nsis\*.exe |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$installer | Format-List FullName,Length,LastWriteTime
```

只应选中本次构建产生的一个 `.exe`。记录应用版本、完整 Git SHA 和文件名。

### 12.3 Authenticode 与受控 staging 例外

生产发布和不受控公开发布必须使用受信任的 Authenticode 签名；**Authenticode 是当前强制停止点**。`0.1.12` 已在负责人明确批准后作为受控 staging 例外发布未签名的 Windows x64 安装包；该批准仅适用于版本 `0.1.12`、仓库提交 `be7dd67ac84275d27b2e3fafe9db8ce0e0cdde9c` 和 staging 环境，不得沿用到其他版本或环境。发布元数据必须记录 `signed: false`，测试用户必须提前知晓 Windows 会显示“未知发布者”。

不得使用自签名证书发布给测试用户。继续前必须由组织完成以下输入：

1. 从受信任证书服务商取得代码签名证书，证书主体与发布组织一致。
2. 私钥保存在硬件令牌、HSM 或经批准的云签名服务中，不能导出到 Git、ECS 或普通共享目录。
3. 由安全负责人提供证书指纹、RFC 3161 时间戳 URL、签名操作者和轮换/吊销流程。
4. 明确供应商要求的签名命令；云签名服务可能不是本地 `signtool`。

若证书已安全安装到 Windows 证书存储，并且供应商确认使用 SignTool，命令形式如下；尖括号值必须来自证书负责人：

```powershell
signtool.exe sign /sha1 <CERTIFICATE_THUMBPRINT> /fd SHA256 /tr <RFC3161_TIMESTAMP_URL> /td SHA256 $installer.FullName
signtool.exe verify /pa /all /v $installer.FullName
Get-AuthenticodeSignature $installer.FullName | Format-List Status,StatusMessage,SignerCertificate,TimeStamperCertificate
```

`verify` 必须成功，PowerShell 的 `Status` 必须为 `Valid`，并且同时存在可信签名者和时间戳证书。没有真实证书、时间戳失败或 Windows 显示未知发布者时停止。

签名后生成哈希：

```powershell
$hash = Get-FileHash -Algorithm SHA256 $installer.FullName
$hash | Format-List Algorithm,Hash,Path
```

哈希必须针对**签名后的最终文件**生成；签名后再改动文件会使哈希和签名失效。

### 12.4 Windows 11 安装 E2E

在一台没有源码、没有开发环境的干净 Windows 11 x64 虚拟机或实机中执行并保存结果：

1. 右键查看安装包数字签名，确认发布者和时间戳正确。
2. 安装，确认 Windows 不显示“未知发布者”。
3. 启动并通过系统浏览器完成 Keycloak 登录和邮箱验证；桌面客户端不得要求 OTP。另在管理端使用已绑定 OTP 的平台管理员完成密码加动态验证码登录。
4. 验证 Liteasy API、论坛 Web/API 和本地文献库关键路径。
5. 安装同产品 ID 的下一候选版本，验证升级后本地库和登录状态符合设计。
6. 从 Windows 设置卸载，再确认程序文件移除且用户文献库没有被误删。

签名发布时任一项失败都保留截图、Windows build、安装包 SHA-256 和日志，停止发布。已批准的未签名 staging 例外应确认签名状态恰为 `NotSigned`，不得把 `HashMismatch`、`NotTrusted` 或其他异常状态当作未签名例外。

### 12.5 受控下载路径

营销站通过体验申请签发短时下载令牌，安装包由与用户 PDF bucket 分离的 waitlist 制品目录提供。自动发布正常情况下由 GitHub Actions 使用短时 OIDC 身份完成；`0.1.12` 因 Actions 账户计费限制未能启动，改由可信 Windows 构建机生成，并经服务器端字节数和 SHA-256 双重核验后原子发布。制品位于 root-only 版本目录 `/var/lib/liteasy/waitlist/releases/0.1.12/`，相邻 JSON 记录提交、哈希、大小、签名状态和发布方式。

`0.1.12` 当前审计基线：文件名 `Liteasy_0.1.12_x64-setup.exe`，大小 `16545637` 字节，SHA-256 `ca889267b3b77be0b86b5d1be668f40598012fed100f57aa3b3d4da38b19d8d1`，`signed: false`。生产和不受控公开发布不能复用这一手工例外；**公开下载路径是当前强制停止点**。

发布前必须另行评审并实现：

1. 与用户 PDF bucket 完全分离的发布制品 bucket 或制品服务。
2. 带版本和 Git SHA 的不可变对象路径，例如 `releases/0.1.0/<git-sha>/Liteasy_0.1.0_x64-setup.exe`；禁止覆盖同一路径。
3. HTTPS 自定义下载域名、访问日志、恶意文件复检、保留策略和回滚策略。
4. 同目录发布 SHA-256 文件和版本说明。
5. 营销站的真实下载按钮和自动化发布步骤，并在外网验证下载后的哈希与第 12.3 节一致。

生产或不受控公开发布仍须完成真实签名和第 12.4 节完整 E2E。受控 staging 例外只能通过申请后的短时令牌分发，不得通过聊天、网盘或无鉴权静态路径分发。

## 13. 常见故障如何判断

### SSH 连接超时

依次检查：

1. ECS 是否运行中。
2. 连接 IP 是否为 `8.217.186.73`。
3. 安全组 TCP `22` 来源是否等于你当前公网 IP 加 `/32`。
4. 家庭宽带公网 IP 是否变化。
5. 使用阿里云 Workbench 进入服务器恢复规则。

### 域名打不开或 Caddy 无法申请证书

依次检查：

1. 六个 A 记录是否都解析为 `8.217.186.73`。
2. 安全组 TCP `80/443` 是否允许 `0.0.0.0/0`。
3. ECS 上是否已有其他程序占用 80/443：

```bash
sudo ss -lntup | grep -E ':(80|443)[[:space:]]'
```

4. 查看 gateway 日志。不要反复申请证书，以免触发 CA 频率限制。

### Keycloak 管理页返回 404

公网开放模式下，`/admin/` 不应由 Gateway 因来源 IP 返回 404。检查 gateway 是否已经更新到当前发布的镜像并重建；Keycloak 内部端口 `8080` 仍不应对公网发布。

### 网页返回 502

`502` 表示 Caddy 能工作，但后端没有准备好。执行 `docker compose ps`，再查看对应 API 或 Keycloak 日志。不要把内部端口发布到公网来绕过 502。

### RDS 连接失败

检查同 VPC/交换机、ECS 私网 IP 白名单、RDS 内网域名、CA 文件和 `verify-full`。不要改成公网 RDS，也不要把 SSL 模式改为 disable。

### 容器反复退出或被杀

执行：

```bash
free -h
sudo dmesg --ctime | tail -100
```

如果出现 OOM 或内存不足，停止邀请测试并升级 ECS。不要依赖无限增加 swap。

### OSS 探针失败

停止 Liteasy 部署。记录失败的 API 名称和状态码，但隐藏 endpoint 中的签名参数、AccessKey 和响应中的敏感字段。不要修改安全断言让探针“变绿”。

## 14. 回滚和生产提升

先判断本次发布的两个迁移输出：

- 如果 Liteasy 和 Intuecho 从第一次执行开始就都是 `{"applied":[]}`，说明本次没有修改数据库 schema，可以执行下面的“仅应用回滚”。
- 如果任一输出列出了迁移文件，**不要直接启动旧镜像**。旧版本会把新迁移视为未知集合并拒绝 readiness；盲目回滚可能造成更长中断。

### 14.1 没有新迁移时的仅应用回滚

操作位置：ECS。先从第 11.12 节的记录目录找到上一成功版本：

```bash
sudo ls -1t /var/lib/liteasy-staging/releases
sudo cat /var/lib/liteasy-staging/releases/<previous-stamp>.git-sha
```

核对 `<previous-stamp>` 对应的是上一成功发布，不是本次失败发布。然后停止公网入口、恢复旧配置和旧 SHA：

```bash
cd /opt/liteasy/repository
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  stop gateway
sudo install -o "$(id -un)" -g "$(id -gn)" -m 0600 \
  /var/lib/liteasy-staging/releases/<previous-stamp>.config.env \
  deployment/staging/config.env
git checkout --detach <previous-git-sha>
git rev-parse HEAD
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  config --quiet
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  pull
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  up --detach --remove-orphans
sudo docker compose \
  --env-file deployment/staging/config.env \
  --file deployment/staging/compose.yaml \
  ps
```

`git rev-parse HEAD` 必须等于记录文件中的 `<previous-git-sha>`。服务恢复后重复第 11.5～11.10 节的验证。不要执行 `docker compose down --volumes`，否则会删除 Caddy 证书状态卷。

### 14.2 已应用新迁移时如何处理

数据库迁移按前向、不可修改方式设计，仓库没有通用降级 SQL。此时只有两条受控路径：

1. 优先构建一个兼容新 schema 的前向修复镜像，按第 11.12 节重新发布。
2. 如果必须回到迁移前状态，保持 gateway 停止，使用第 11.3 节记录的迁移前恢复点，把整个 RDS 恢复到**新的隔离实例**；按第 11.11 节验证三个数据库、迁移集合和权限，再由两人复核后切换所有数据库 URL。涉及 PDF/object schema 时还必须恢复匹配时间点的独立对象 bucket。

不要把 PITR 直接覆盖原 RDS，不要删除已应用 migration 记录，不要编辑旧 SQL checksum，也不要只恢复 Liteasy 而让 Intuecho/Keycloak 留在另一个不一致时间点。仓库当前没有自动执行跨 RDS 和 OSS 一致切换的程序，因此该路径属于事故变更，必须由熟悉 PostgreSQL、OSS 和本项目配置的人现场执行并保留变更记录。

生产环境必须另建域名、ECS/容器平台、RDS 数据库、bucket、独立 secret 和配置目录，并重新评估托管秘密服务。只能提升经过评审的镜像 digest；不得把这个可变的预发布主机或其数据库原地改名为生产。

## 15. 受控 10 人预发布的最终门禁

以下全部完成前，不得邀请测试人员；完成后也只授权本节定义的 10 人限量预发布：

- 公网 IP 已确认可长期保留，六个 A 记录都只指向该地址。
- ECS 仓库、构建记录和四个应用镜像对应同一完整 Git SHA，镜像全部以 digest 固定。
- OSS S3 契约探针针对目标 bucket 返回 `verified: true`。
- 真实私有 HTTPS PDF 扫描服务通过安全和故障测试。
- RDS TLS、自动备份、PITR 和一次隔离恢复演练有证据。
- 两个应用数据库账号不能创建 schema 对象，也不能写 `schema_migrations`。
- Keycloak SMTP、邮箱验证、MFA、恢复流程和具名管理员已验证。
- Liteasy、Intuecho、管理端和 Keycloak 的 HTTPS 健康检查通过。
- 桌面端、Intuecho Web、管理端签发并验证彼此独立的 audience。
- Windows 安装包已完成 Authenticode 签名和 Windows 11 E2E。
- 营销站已提供带版本、已签名安装包的真实下载路径。
- Docker 日志轮转为 `json-file 10m 5`，SLS 已采集容器日志和维护结果。
- 每日维护任务手工运行成功、timer 已启用，测试失败日志确实触发联系人告警。
- ECS、RDS、OSS 和公网健康监控已启用，至少两名联系人完成通知验证。
- Keycloak 中只有审批过的具名测试账号，诊断账号和临时 client 已清理；第 10 个账号完成验证后已关闭自助注册。
- PDF 扫描器实际运行配置为 `PDF_SCANNER_MAX_CONCURRENT=1`、`PDF_SCANNER_MAX_BYTES=33554432`，并用一个接近 32 MiB 的 PDF 完成单路上传验收。
- `/readyz` 明确显示 `modelProxy: "configured"`；模型生成仅向具名测试账号开放，部署密钥保持 root-only，测试说明列明限量、值守和停止条件，且未批准匿名访问、公开推广或高并发批处理。
- 已配置可用内存、swap、容器 OOM/重启和公网 readiness 告警；任一停止条件触发时有明确值班人暂停测试。
- 已用 10 个独立测试账号完成受控容量验收：同时登录和浏览论坛，串行完成 PDF 上传/扫描；期间无 OOM、无意外容器重启、无连续 readiness 失败，且资源未触发停止阈值。

门禁通过后的发布记录必须写明：`release_scope=controlled-10-user-staging`、10 个账号的非敏感标识、允许功能、禁用功能、PDF 限制、值班人、开始/结束时间和停止条件。不得使用“正式上线”“生产可用”或“公开发布完成”描述本环境。

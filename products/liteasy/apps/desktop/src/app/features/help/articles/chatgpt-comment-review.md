让 ChatGPT 结合论文原文，检查你在阅读时留下的疑问、理解和论证。你在 Liteasy 选择共享内容，在 ChatGPT 中提问并查看评审。

## 使用前准备

- 使用 Linux 或 macOS 的 Liteasy 桌面版，并保持应用打开。Windows 和浏览器版暂不支持此连接。
- 在同一台电脑、同一操作系统用户下运行评论连接服务，需要 Node.js 20 或以上版本。
- ChatGPT 账号需要能够启用开发者模式并添加 MCP 连接，是否可用取决于账号和工作区权限。
- 首次配置需要 Liteasy 源码目录以及私有隧道或 HTTPS 转发入口。当前不能只通过在 Liteasy 登录 ChatGPT 账号完成连接。

此功能只读取你主动共享的一篇论文的个人文字评论、引用、评论所在页的文本及已有 AI 回答。团队评论、其他论文、图片与手绘不包含在内。纯高亮或没有文字的批注会计入排除数量，不会被当成已评审的文字评论。

评审保留在 ChatGPT，不会自动写回或覆盖 Liteasy 评论。Liteasy 不为此调用本地 Agent 或模型 API；ChatGPT 自身的使用限制仍适用。

## 第一次连接：安装评论连接服务

在终端中进入你的 Liteasy 源码目录，再执行：

```bash
cd products/liteasy/services/review-mcp
npm ci
```

下面两种连接方式选择一种即可。连接配置好以后，日常使用只需保持相应连接进程和 Liteasy 桌面版运行。

## 方式一：私有隧道

私有隧道适合不希望将本机服务暴露到公网的用户。

1. 按 [OpenAI Secure MCP Tunnel 说明](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) 安装 `tunnel-client`，创建自己的隧道并关联要使用的 ChatGPT 工作区。
2. 在运行隧道的终端环境中配置 `CONTROL_PLANE_API_KEY`。这是隧道的控制面凭据，不是 Liteasy 用来调用模型的密钥。不要写入共享文档或源码。
3. 执行下面的配置命令，将 `YOUR_TUNNEL_ID` 换成你的隧道 ID，将 `/absolute/path/to/Liteasy` 换成源码目录的绝对路径。

```bash
tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile liteasy-review \
  --tunnel-id YOUR_TUNNEL_ID \
  --mcp-command "node /absolute/path/to/Liteasy/products/liteasy/services/review-mcp/src/main.mjs --stdio"
tunnel-client doctor --profile liteasy-review --explain
tunnel-client run --profile liteasy-review
```

保持最后一条命令运行。隧道会启动评论连接服务，不需要再执行 `npm start`。

在 ChatGPT 的开发者模式连接设置中，新增一个名为 **Liteasy 评论 Review** 的连接，选择 **Tunnel** 并选中自己的隧道。参见 [ChatGPT 连接与测试说明](https://developers.openai.com/plugins/deploy/connect-chatgpt)。

创建隧道需要 Tunnels Read + Manage 权限，运行和选择隧道需要 Read + Use 权限；这与 ChatGPT 开发者模式权限不同。隧道未出现时，检查它是否关联到当前 ChatGPT 工作区。

个人论文连接仅供本人使用，不要将它关联到其他人可使用的共享工作区。

## 方式二：HTTPS 地址与访问令牌

如果你已有 HTTPS 转发服务，并且 ChatGPT 连接界面支持 **Access token / API key**，可以选择此方式。如果界面只提供 OAuth，请使用私有隧道；Liteasy 评论连接目前不提供 OAuth 登录。

在评论连接服务目录中，首次创建本机私有令牌文件：

```bash
mkdir -p "$HOME/.config/liteasy-review"
chmod 700 "$HOME/.config/liteasy-review"
node --input-type=module -e 'import { randomBytes } from "node:crypto"; import { writeFileSync } from "node:fs"; import { homedir } from "node:os"; writeFileSync(homedir()+"/.config/liteasy-review/token", randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });'
```

文件已存在时，创建命令会拒绝覆盖；继续使用已有令牌即可。每次启动连接服务时执行：

```bash
export LITEASY_REVIEW_TOKEN_FILE="$HOME/.config/liteasy-review/token"
npm start
```

将你自己的公网 HTTPS 地址转发到 `http://127.0.0.1:4319/mcp`，保留 `Authorization` 请求头。ChatGPT 不能直接访问这个本机地址。

如果转发服务保留公网域名作为 Host，请在启动前设置允许的域名，再执行 `npm start`：

```bash
export LITEASY_REVIEW_PUBLIC_HOSTS=mcp.example.com
```

把示例域名换成你实际使用的域名。在 ChatGPT 新增连接，填写 `https://你的域名/mcp`，并将本机令牌文件中的值填入访问令牌栏。该值不是 OpenAI API key，也不是 Liteasy 登录凭据；不要把它放在 URL、聊天消息或截图中。保持转发服务和 `npm start` 运行。

## 每次使用：共享、提问、停止共享

1. 在 Liteasy 打开需要评审的论文，先保存评论。如果需要更多原文上下文，先打开评论所在页，等待文本解析。
2. 在 PDF 批注栏展开 **ChatGPT 评论 Review**，点击 **共享本篇评论**。
3. 在 ChatGPT 对话中选择 Liteasy 评论连接并提问，例如：

   > Review 我共享的论文中的全部评论。先读完所有评论和分页，再结合原文逐条评估，引用评论 ID 和 PDF 页码。区分我的观点与已有 AI 回答，缺少原文时明确说明。最后总结理解偏差、未解决问题和进一步阅读建议。

4. 编辑评论或更多页面完成解析后，点击 **更新共享快照**，再请 ChatGPT 重新读取当前共享。共享内容不会随编辑自动改变。
5. 完成后点击 **停止共享**。切换论文、切换账号或关闭阅读器也会撤销共享；再次使用时需要重新开启。

“快照”就是点击共享时保存的一份内容。更新共享后，旧的分页读取会失效，避免一次评审混入两篇论文或不同版本的评论。

停止共享会阻止后续读取，但不能撤回 ChatGPT 已经接收的内容。

## 常见问题

| 遇到的问题 | 可以怎么做 |
| --- | --- |
| “共享本篇评论”按钮不可用 | 确认使用 Linux/macOS 桌面版，等待批注恢复完成；浏览器版和 Windows 暂不支持。 |
| 没有可供 Review 的评论 | 先为批注添加并保存文字评论。只有高亮、图片或笔迹的条目不属于文字评论。 |
| ChatGPT 提示未共享评论 | 在当前论文的批注栏重新开启共享，并确认连接的是同一台电脑上的 Liteasy。 |
| 更新共享后提示旧内容已失效 | 请 ChatGPT 重新读取当前共享，从新快照开始评审。 |
| 连接服务提示桌面不可用或超时 | 打开 Liteasy 桌面版，并以相同操作系统用户运行连接服务；不要将本机连接服务放进无法访问桌面的远程容器。 |
| ChatGPT 看不到隧道 | 检查工作区关联、Tunnels Read + Use 权限，并确认 `tunnel-client run` 正在运行。 |
| HTTPS 连接返回 401 | 检查访问令牌是否与本机文件一致，以及转发服务是否保留 Authorization 请求头。 |
| HTTPS 连接返回 403 | 核对转发后的 Host 是否已通过 `LITEASY_REVIEW_PUBLIC_HOSTS` 允许。 |
| 缺少评论所在页的原文 | 在阅读器打开该页，等待解析后更新共享。扫描件或尚未提取文本的页面可能仍不可用；请 ChatGPT 明确说明缺失证据。 |
| ChatGPT 只评审了部分评论 | 请它继续读取剩余分页和长评论，并核对已处理数量与共享的评论总数；不要把部分结果当成全文评审。 |
| 在 Liteasy 中找不到生成的评审 | 此连接只读，评审位于 ChatGPT 对话中，目前不会自动保存回 Liteasy。 |

高级连接参数和协议排错说明位于源码目录的 `products/liteasy/services/review-mcp/README.md`。

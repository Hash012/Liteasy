让 ChatGPT 结合可用原文检查你阅读时留下的疑问和论证。它与“本机资产 MCP”是两条不同连接，不要互换配置或平台支持结论。

## 使用前准备
当前评论连接要求 **Linux 或 macOS 桌面版**；Windows 与浏览器版暂不支持。保持 Liteasy 打开，在同一电脑、同一操作系统用户下运行连接服务，需要 Node.js 20 或以上、源码目录，以及有权限添加开发者连接的 ChatGPT 账号／工作区。

此功能只读你主动共享的一篇论文的个人文字评论、引用、评论页已有文本和已有 AI 回答，不包括其他论文、团队评论、图像和手绘。只有颜色、没有文字的高亮不属于文字评审。结果保留在 ChatGPT，不会自动写回 Liteasy。

## 安装连接服务
在 Liteasy 源码目录执行：
```bash
cd products/liteasy/services/review-mcp
npm ci
```
日常使用不需要反复安装，但需要保持连接进程和桌面应用运行。

## 方式一：私有隧道
根据 [OpenAI Secure MCP Tunnel 文档](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) 安装客户端、创建自己的隧道并关联使用的工作区。在运行它的终端配置 `CONTROL_PLANE_API_KEY`，它是控制面凭据，不是模型 API key，不应写到共享文档。

把下面的隧道 ID 和源码绝对路径换成自己的真实值：
```bash
tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile liteasy-review \
  --tunnel-id YOUR_TUNNEL_ID \
  --mcp-command "node /absolute/path/to/Liteasy/products/liteasy/services/review-mcp/src/main.mjs --stdio"
tunnel-client doctor --profile liteasy-review --explain
tunnel-client run --profile liteasy-review
```
保持最后的进程运行。它会启动评论连接服务，无需再额外运行 `npm start`。在 ChatGPT 开发者连接界面选择 Tunnel 与自己的隧道；具体菜单和账户条件以 [官方连接说明](https://developers.openai.com/plugins/deploy/connect-chatgpt) 为准。

创建隧道需要相应 Read + Manage 权限，运行和选择需要 Read + Use；这不同于开发者模式权限。个人论文连接只供本人使用，不关联其他人可访问的共享工作区。

## 方式二：HTTPS 与访问令牌
仅当你有可信 HTTPS 转发，且当前 ChatGPT 连接支持 Access token／API key 时使用。该评论服务未提供 OAuth；只有 OAuth 选项时改用私有隧道。

在连接服务目录先创建私有令牌文件：
```bash
mkdir -p "$HOME/.config/liteasy-review"
chmod 700 "$HOME/.config/liteasy-review"
node --input-type=module -e 'import { randomBytes } from "node:crypto"; import { writeFileSync } from "node:fs"; import { homedir } from "node:os"; writeFileSync(homedir()+"/.config/liteasy-review/token", randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });'
export LITEASY_REVIEW_TOKEN_FILE="$HOME/.config/liteasy-review/token"
npm start
```
文件已存在时命令拒绝覆盖，继续使用自己的已有令牌。将自己的公网 HTTPS 入口转发到 `http://127.0.0.1:4319/mcp`，保留 Authorization 请求头；ChatGPT 不能直接访问这个本机地址。

转发保留公网 Host 时，在启动前设置 `LITEASY_REVIEW_PUBLIC_HOSTS` 为你实际域名。连接地址填自己的 HTTPS `/mcp`，令牌填访问令牌栏，不能放进 URL 或聊天消息。保持转发与服务运行；不熟悉转发权限时优先使用私有隧道。

## 每次评审
1. 打开目标论文，保存文字评论，并打开需要引用原文的页面，等待文本可用。
2. 在 PDF 批注栏展开 **ChatGPT 评论 Review**，点击 **共享本篇评论**。
3. 在 ChatGPT 选择该连接，要求逐条读取全部分页，引用评论 ID 与 PDF 页码，区分你的观点和已有 AI 回答；缺原文时明确说明。
4. 编辑评论或加载更多页面后，点击 **更新共享快照**，再让客户端重读。快照不会随编辑自动改变，旧分页可能失效。
5. 完成后点击 **停止共享**。切换论文、账号或关闭阅读器也会撤销。

**停止共享只能阻止后续读取，不能撤回 ChatGPT 已经收到的内容。**

## 排错
按钮不可用先核对平台与批注恢复状态；没有评论先添加文字；旧快照失效重新读取；401 核对令牌与 Authorization，403 核对 Host 允许列表。缺少原文时打开对应页并更新快照，扫描件可能仍无可用文字。只评审了一部分时让客户端继续分页，核对数量，不把局部评审当全文完成。

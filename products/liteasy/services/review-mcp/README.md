# Liteasy 评论 Review MCP

用户在 ChatGPT 内 review 一篇论文的个人文字评论。Liteasy 提供显式共享的评论快照、引用与页内文本；ChatGPT 生成评审。本服务不调用模型、不启动 Liteasy Agent，也不修改评论或把评审写回文献。

面向用户的完整步骤已收录到应用内 **帮助 → 文献与阅读 → 连接 ChatGPT Review 论文评论**，也可阅读 [用户手册正文](../../apps/desktop/src/app/features/help/articles/chatgpt-comment-review.md)。本文件保留服务配置和协议验证说明。

首期支持 **Linux/macOS Tauri 桌面版 + Node.js 20+**。Windows 的现有 external Agent host 尚无传输实现；浏览器版没有本机 host。此目录可独立安装，不依赖 `development/` 或 `tmp/`。

## 架构与范围

```text
ChatGPT → 私有隧道（stdio）或 HTTPS 转发（HTTP + Bearer）
        → Review MCP Server → Desktop Runner → 本机 Liteasy socket
        → controller → 当前阅读器显式共享的个人评论快照
```

- 仅提供四个只读工具：`liteasy_review_current`、`liteasy_review_comments`、`liteasy_review_comment`、`liteasy_review_page`。
- 返回评论 ID、批注修订号、PDF 页码、用户文字、引用以及独立的已有 AI 内容。没有 sourcePath、账号 token、团队批注或全库浏览接口。
- 首次调用获取 `reviewId`，后续分页必须携带此 ID。更新共享生成新 ID；旧请求明确失败，不重新指向新论文。
- 每页最多 20 条评论，长字段通过最多 8,000 个 UTF-16 单元的分段读取补全，返回 `nextOffset`；不将截断内容冒充全文。
- 页内上下文仅限含评论的页面。没有提取文本的页面返回 `available=false`；不会现场执行 OCR 或伪造正文。可先在阅读器打开相应页面，等待解析，再更新共享。
- 只包含文字评论/速问中的用户问题；纯高亮、无文字手绘等排除数量会被报告。图片和笔迹不导出。已有 AI 答案与 review 使用独立字段。
- 快照只在桌面内存中保存；关闭共享、切换论文、切换账号或卸载阅读器会撤销。停止共享不能撤回 ChatGPT 已经读取的内容。
- 此版本是单用户本机连接，不是多租户托管服务。Bearer 或隧道访问者可以读取当前共享快照，连接只应交给本人使用。

本次参考了 `tmp/webcodex`（`3fdb1a9d`）的 `docs/MCP.zh-CN.md`、`src/mcp_tests/http_transport.rs`、`src/project_entry_openai_tunnel.rs`，采用 Server/Runner 分离、显式权限、可达性与权限分离以及有界结构化返回的思路。没有复制其通用命令执行或完整作业系统：本期长时间推理由 ChatGPT 承担，本机仅做短时读取，10 秒超时并支持取消，无隐藏重试。文件导入导出和写回评审留给后续明确需要的功能。

## 安装

从仓库根目录进入：

```bash
cd products/liteasy/services/review-mcp
npm ci
npm test
```

使用包含本次前端改动的 Liteasy 桌面版，并以同一操作系统用户运行连接进程。开发时可在另一个终端启动 `products/liteasy/apps/desktop` 下的 `npm run tauri dev`。

默认 socket 与桌面宿主一致：Linux 为 `$XDG_DATA_HOME/com.liteasy.desktop/agent.sock`（未设置时使用 `~/.local/share`）；macOS 为 `~/Library/Application Support/com.liteasy.desktop/agent.sock`。自定义时给桌面与本服务设置同一个 `LITEASY_AGENT_SOCKET`。

## 方式 A：私有 Secure MCP Tunnel + stdio

stdio 入口：

```bash
node /absolute/path/to/Liteasy/products/liteasy/services/review-mcp/src/main.mjs --stdio
```

它是机器协议进程，不是交互式终端；由 MCP 客户端或隧道启动。stdout 只输出协议消息。

按官方 [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) 创建/关联自己的 tunnel，安装 `tunnel-client`，为其提供控制面凭据。创建需要 Tunnels Read + Manage，运行需要 Read + Use；ChatGPT developer mode 是另一项账号/工作区权限。控制面 key 用于隧道，不是本服务调用模型的 key。

配置示例（替换隧道 ID 和绝对路径；先在运行环境中配置 `CONTROL_PLANE_API_KEY`，不要写入仓库）：

```bash
tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile liteasy-review \
  --tunnel-id YOUR_TUNNEL_ID \
  --mcp-command "node /absolute/path/to/Liteasy/products/liteasy/services/review-mcp/src/main.mjs --stdio"
tunnel-client doctor --profile liteasy-review --explain
tunnel-client run --profile liteasy-review
```

stdio 模式没有 HTTP Bearer：访问控制由本人隧道关联与桌面逐次共享检查承担。不要将个人连接关联到其他用户可使用的共享工作区。服务不会自动创建隧道、读取 OpenAI 凭据或改变工作区配置。

## 方式 B：HTTP + Bearer

首先生成并妥善保管一个随机 token 文件。示例只输出到本机私有文件，不打印 token：

```bash
mkdir -p "$HOME/.config/liteasy-review"
chmod 700 "$HOME/.config/liteasy-review"
node --input-type=module -e 'import { randomBytes } from "node:crypto"; import { writeFileSync } from "node:fs"; import { homedir } from "node:os"; writeFileSync(homedir()+"/.config/liteasy-review/token", randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });'
export LITEASY_REVIEW_TOKEN_FILE="$HOME/.config/liteasy-review/token"
npm start
```

默认监听 `http://127.0.0.1:4319/mcp`，只接受通过鉴权的 stateless MCP POST。支持 `LITEASY_REVIEW_PORT`；转发保留公网 Host 时，通过 `LITEASY_REVIEW_PUBLIC_HOSTS=mcp.example.com` 显式允许。拒绝非允许 Host、浏览器跨源请求和 query token；不启用无认证模式。

hosted ChatGPT 不能直达本机 loopback。需要将 `/mcp` 通过本人控制的 HTTPS 转发暴露，并保留 Authorization 头。在支持 Access token/API key 的客户端中，填写 token 文件中的值；若客户端只提供 OAuth，请使用方式 A，本期没有伪造 OAuth discovery，也没有公网 OAuth 服务。

## 在 ChatGPT 中使用

按官方 [连接与测试说明](https://developers.openai.com/plugins/deploy/connect-chatgpt) 启用 developer mode，添加 MCP 连接；私有方式选择 Tunnel，HTTPS 方式填写包含 `/mcp` 的地址及客户端支持的认证方式。具体可用入口受账号与工作区权限影响。

1. 在 Liteasy 打开论文，保存评论，展开批注栏的 **ChatGPT 评论 Review**。
2. 点击 **共享本篇评论**。评论修改或更多页完成文本解析后，点击 **更新共享快照**。
3. 在 ChatGPT 对话中启用此连接并提问：

   > Review 我共享的论文中的全部评论。先读完所有分页，对每条疑问结合原文评估，引用评论 ID 和 PDF 页码。区分用户观点与已有 AI 回答；缺少正文时明确说明。最后总结理解偏差、未解决问题与建议进一步阅读的内容。

4. 结束后点击 **停止共享**。评审保留在 ChatGPT，本期不自动写回 Liteasy。

## 验证与限制

```bash
# 本目录：真实 MCP SDK 客户端、HTTP/stdio、socket 协议、鉴权和取消
npm test

# products/liteasy/apps/desktop
npx vitest run src/tests/paperReviewShare.test.tsx src/tests/paperReviewHostBridge.test.tsx src/tests/PdfAnnotationReview.test.tsx src/tests/agentApiAdapters.test.ts
npm run build
npx playwright test src/tests/browser/paperReview.browser.spec.ts
```

自动化测试使用构造评论和受控桌面 socket；它们验证协议与隔离，不代表真实 ChatGPT 已完成评审。浏览器截图位于桌面 `test-results/paper-review-share.png`，是测试夹具界面，不包含用户数据。

尚需以真实账号连接 ChatGPT，并在 Linux/macOS 桌面端验收完整链路；尤其核对隧道可用权限、每条评论覆盖率、PDF 无文本层提示和停止共享后的拒绝行为。Windows、团队评论、图片/手绘、多用户远程部署及评审写回不在本期实现范围。

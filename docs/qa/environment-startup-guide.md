# LiteasyClaw 启动与本地联调指南

本文档用于从零启动 LiteasyClaw，并重点说明论文 Agent、流式多模态产物和真实模型接口的本地联调方式。

所有命令都以仓库根目录为起点，示例中不依赖某个开发者的绝对路径。

## 1. 最短启动路径

如果要在浏览器中使用真实模型验证 ACORN、ColBERT 等论文的树形展开，推荐使用：

```bash
cd development/dev-cloud
npm install

cd ../../products/liteasy/apps/desktop
npm install
npm run dev
```

`dev` 会完成这些事情：

1. 从被 Git 忽略的 `development/dev-cloud/.env.local` 读取模型地址和密钥。
2. 默认使用 `gpt-5.4-mini`。
3. 同时启动 Liteasy dev-cloud 和 Vite 前端。
4. 检测 dev-cloud 端口冲突；默认端口被占用时自动选择后续空闲端口。
5. 将实际 dev-cloud 端口注入桌面前端，避免前端仍然请求旧端口。

启动日志中的实际地址是唯一准确信息。一般会看到：

```text
[dev:cloud] LiteasyClaw dev cloud listening on http://127.0.0.1:<实际端口>
[dev:desktop] Local: http://127.0.0.1:1420/
```

用浏览器打开 `http://127.0.0.1:1420/` 即可。

> 密钥只能写入被 Git 忽略的 `development/dev-cloud/.env.local` 或由进程环境安全注入。不要把密钥复制到截图、issue、终端命令或普通文档中。

## 2. 环境要求

开发云要求 Node.js 20 或更高版本：

```bash
node -v
npm -v
```

启动完整 Tauri 桌面窗口时还需要 Rust 与当前操作系统所需的 Tauri 系统依赖：

```bash
cargo --version
rustc --version
```

如果当前终端找不到 `cargo`，Linux/macOS 常见处理是：

```bash
source "$HOME/.cargo/env"
```

首次拉取项目后，需要分别安装两个 Node 包的依赖：

```bash
cd development/dev-cloud
npm install

cd ../../products/liteasy/apps/desktop
npm install
```

## 3. 选择启动模式

### 3.1 真实测试 API + 浏览器前端（推荐用于 Agent 联调）

```bash
cd products/liteasy/apps/desktop
npm run dev:test-api
```

适用于：

- 验证论文问答和多论文分析。
- 验证树形展开、思维导图、PPT 等多模态产物。
- 检查右侧 AI Chat 的流式进度。
- 验证 Agent 失败详情、重试与本地持久化。

`dev:test-api` 是兼容命令，与 `npm run dev` 使用同一 `.env.local` 安全加载和端口编排链路，不会要求把密钥写入 shell 历史。

### 3.2 普通本地开发（未配置模型）

```bash
cd products/liteasy/apps/desktop
npm run dev
```

这条命令同样会启动 dev-cloud 和 Vite。没有配置真实模型密钥时，账号、组织和文件系统等本地业务仍可开发；模型接口会明确返回不可用，不会生成内置或 mock 回答。

### 3.3 完整 Tauri 桌面应用

Tauri 的 `beforeDevCommand` 会自动运行 `npm run dev`，因此不需要预先再启动一套 Vite。

如果要在 Tauri 中调用真实 OpenAI 兼容接口，在本地创建以下两个文件。

`development/dev-cloud/.env.local`：

```dotenv
OPENAI_API_KEY=<本地密钥>
OPENAI_BASE_URL=<以 /v1 结尾的 API 根地址>
LITEASY_MODEL_PROVIDER=openai
```

`products/liteasy/apps/desktop/.env.local`：

```dotenv
VITE_LITEASY_OPENAI_MODEL=gpt-5.4-mini
```

这两个 `.env.local` 已被 Git 忽略。不要把真实密钥写入 TypeScript、测试或已跟踪的配置文件。

然后启动：

```bash
cd products/liteasy/apps/desktop
source "$HOME/.cargo/env"
npm run tauri dev
```

如果需要让 Tauri 使用自定义测试服务，请把 API 地址和密钥写入上面的 dev-cloud `.env.local`，不要把密钥直接写进启动命令。

### 3.4 分终端调试

需要单独观察开发云和前端日志时，可以显式使用同一个端口。

终端 1：

```bash
cd development/dev-cloud
LITEASY_DEV_CLOUD_PORT=8791 npm start
```

终端 2：

```bash
cd products/liteasy/apps/desktop
VITE_LITEASY_DEV_CLOUD_PORT=8791 npm run dev:desktop
```

这里的 `8791` 只是示例；可以换成任意空闲端口，但两边必须一致。

## 4. 确认实际端口与服务身份

组合启动脚本会从 8787 开始寻找空闲端口。不要假设开发云一定运行在 8787，应以终端日志为准。

假设日志显示端口为 8791，可以执行：

```bash
curl --noproxy '*' http://127.0.0.1:8791/healthz
```

预期结果：

```json
{"ok":true}
```

再检查根地址：

```bash
curl --noproxy '*' http://127.0.0.1:8791/
```

返回内容应明确属于 LiteasyClaw dev-cloud。如果看到其他应用的 HTML、Uvicorn 页面或无关 JSON，说明端口上运行的不是 Liteasy 服务。

## 5. 可选：验证真实模型流式链路

下面的请求会真实消耗测试接口额度，仅在需要排查模型连接时执行：

```bash
curl --noproxy '*' -N http://127.0.0.1:8791/v1/model/generate-stream \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-5.4-mini",
    "prompt": "只回答：Liteasy upstream ok",
    "provider": "openai"
  }'
```

成功时会持续返回 NDJSON `delta`，最后返回 `completed` 事件；其中 `execution.mode` 应为 `live`，`execution.provider` 应为 `openai`。

如果实际端口不是 8791，请替换命令中的端口。

## 6. 验证论文 Agent

启动页面后，按以下顺序验证 ACORN 树形展开：

1. 在左侧文献库展开目录并选中 ACORN。
2. 锁定当前文献集。
3. 在多模态入口选择“树形展开”。
4. 右侧 AI Chat 应立即出现一个独立生成 session，并持续更新阶段、进度和流式文本。
5. 中央区域应逐步渲染树节点，而不是等待结束后一次性显示制表符文本。
6. 完成后，论文文件节点下应出现对应产物条目；关闭标签页或重新登录后仍可从文献库重新打开。

若失败，产物区域和对应 AI session 应显示：

- 原始错误原因；
- 失败阶段；
- Agent 本地端点；
- Provider 与模型；
- 发生时间；
- 针对 401、404、429、网络失败等情况的恢复建议。

`PDF parsed` 只表示论文证据已经可以检索，不代表 Agent 分析已经完成。最终状态应以多模态生成任务自身的阶段为准。

## 7. 常见故障

| 现象 | 优先检查 |
| --- | --- |
| `EADDRINUSE` | 使用 `npm run dev` 或 `npm run dev:test-api` 让脚本自动选端口；手动模式下换一个端口。 |
| `/healthz` 返回 HTML 或其他应用内容 | 请求到了错误服务；核对启动日志中的实际端口。 |
| 前端仍请求 8787 | 重启 Vite/Tauri。`VITE_*` 环境变量不会被已运行的前端进程重新读取。 |
| 401 / Unauthorized | 检查测试密钥是否有效；修改配置后必须重启 dev-cloud。 |
| 404 / `/responses` 不存在 | 确认 `OPENAI_BASE_URL` 是正确的 `/v1` 根地址，并且上游支持 OpenAI Responses API。 |
| 429 / rate limit | 停止重复压力请求，等待额度或限流窗口恢复后再试。 |
| 503 或 HTTP 200 空流 | 当前实现会有限重试；持续失败通常表示上游代理不稳定，应保留界面中的时间和详细错误。 |
| UI 显示 `parsed`，但产物尚未完成 | 解析与 Agent 生成是两个独立生命周期，查看右侧生成 session 和产物任务进度。 |
| Tauri 窗口没有出现 | 检查 `cargo --version`、系统 Tauri 依赖以及终端最后一段 Rust/Vite 错误。 |

## 8. 停止服务

组合启动时，在运行 `npm run dev` 或 `npm run dev:test-api` 的终端按 `Ctrl+C`，脚本会同时停止 Vite 和 dev-cloud。

分终端启动时，需要在两个终端中分别按 `Ctrl+C`。

## 9. 测试与构建

修改桌面端后：

```bash
cd products/liteasy/apps/desktop
npm test
npm run build
```

修改开发云后：

```bash
cd development/dev-cloud
npm test
```

提交问题时请附上：执行目录、完整启动命令、实际端口、失败阶段和报错文本。不要附带 API Key。

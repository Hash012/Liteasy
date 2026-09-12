# 薄读恢复、公开推理与论文服务接入

日期：2026-09-12。当前工作分支：main。由用户上传，本次不自动 push。

## 产品设定

- 设置 → 论文与薄读提供“快速 / 严谨”。默认快速。两者都不设固定字数、句数，不因局部证据不足拒绝整个讲解。
- 快速直接生成结构化正文；严谨额外做一次提示性核验。核验失败保留已经生成的正文，并提示读者对照原文；不伪造“通过审计”。旧文档和旧调用结构继续兼容。
- PDF 的薄读按钮、主 Agent 的引用/指令与薄读深入入口共享产物工作流。新任务记录原论文、文本、用户补充材料、父节点上下文、模型设置与模式；恢复时不读取后来更改的选中文献集来替代原输入。
- 流式正文只展示 summary 草稿，结构协议字段不直接给用户看。API 确实提供的公开 reasoning_content / reasoning / Anthropic thinking 单独显示。不解密 redacted_thinking，不展示 signature；未提供公开推理时不编造。
- 点击“中断薄读”停止当前模型调用，保留草稿；失败/中断后可“继续薄读”。网络错误最多自动重试两次。应用重启后加载恢复记录，由用户明确继续。
- 恢复按阶段进行：已经完成的正文直接复用，只继续核验/保存等未完成阶段。中途断开的流式请求使用原上下文和草稿重新请求完整结构；不声称能恢复服务商已经断开的同一条 HTTP 流。
- 文献左键打开。身份确认、重命名、标签和回收站操作进入右键菜单。左/右/下栏开关移到最左侧活动栏。

## 存储与 Windows 路径

- Tauri 的 AppData 下保存 artifact-tasks / thin-reading / paper-services 检查点 JSON，复用支持 Windows 的原子写入。密钥独立保存在系统凭据库，不进入 JSON 或 React 设置。
- 浏览器开发预览使用 localStorage 存储非敏感工作流数据；API key 仅存在本次页面内存，刷新后需重新填写。Windows 安装版不受该预览限制。
- 正文生成前保存提示词、模式、模型和原证据；流式草稿定期保存，失败及阶段结束再次保存。原证据编号随检查点保留，避免重启后引用失配。产物落盘后清理该节点临时检查点。
- 文献产物仍保存为版本化的 liteasy.thin-reading/v2 文档，可继续深入，保持 Lib → 论文子条目 → 展示页的路径。模式核验说明保存在 evidence.readingReview，原图推荐仍按真实 figureId 关联。
- 损坏或过大的检查点报错并保留原文件，不自动以空数据覆盖。单个存储文件上限 64 MiB；MinerU ZIP 解压总量上限 40 MiB，超限明确报错。

## 元信息服务

- Crossref：默认 https://api.crossref.org，公共查询不需要 key，Plus key 可选。
- OpenAlex：https://api.openalex.org，api_key 查询参数。
- Semantic Scholar：https://api.semanticscholar.org/graph/v1，x-api-key 请求头。
- Liteasy 云端：保留原有账号服务路线。
- 优先按 DOI 精确查询，标题才使用搜索。公开服务的查询返回可确认候选，保留 DOI/OpenAlex/Semantic Scholar 标识；用户确认后保存在本机。公共注册信息不等同于已在 Liteasy/Intuecho 服务器完成账号鉴权或发布，不能据此宣称社区服务已验收。

## MinerU

官方模式：https://mineru.net，Bearer key。
1. POST /api/v4/file-urls/batch 申请批次和文件上传地址。
2. PUT 原始 PDF 到签名地址，不转发 API key。
3. GET /api/v4/extract-results/batch/{batch_id} 查询进度。
4. 下载 full_zip_url，读取 full.md、content_list.json 和图片；页面编号从 page_idx 转为用户可见的 1-based 页码。

申请批次、上传完成、提取结果分别持久化。网络中断后重用批次查询/下载，不重付一次上传解析；上传签名过期时提示重新解析。兼容服务模式提供 POST /v1/pdf/mineru-extract，输入 {bytesBase64, filename}，返回 {pages:[{page,text}], markdown?, figures?}。

解析缓存优先用文献内容哈希匹配，同一文件换路径后仍可复用；无哈希时核对原路径。仅已保存 MinerU 正文的论文提供阅读模式。PDF 工具栏可显式发起解析；解析后图文阅读复用现有 Markdown/公式/本地图片展示组件，可返回 PDF。普通 PDF.js 文本提取不冒充 MinerU 解析。

## 协议依据

- https://mineru.net/apiManage/docs
- https://www.crossref.org/documentation/retrieve-metadata/rest-api/
- https://help.openalex.org/api/get-single-entities/
- https://api.semanticscholar.org/api-docs/graph
- https://api-docs.deepseek.com/guides/reasoning_model

## 验证记录

Node.js 22.23.2 下最终验证：桌面单元/集成测试 2157 通过、4 按项目条件跳过（322 个测试文件通过、2 跳过）；cargo test --locked：75 通过；npm run build 与生产资源检查通过；Tauri 已跟踪资源路径检查通过。五条浏览器流程全部通过：未登录模型配置与对话持久化、阅读栏与引用展示、真实 PDF 薄读保存重开、断网草稿重启恢复、MinerU 阅读模式离线恢复（同时覆盖右键编辑）。浏览器自动化使用仓库真实 PDF 和隔离的 API 响应测试数据；不包含真实密钥，不把这些测试宣称为付费 MinerU / 模型服务验收。Windows 安装包仍需用户上传后由 GitHub Actions 在 Windows runner 上实际构建。


### 真实公共 API 核验

对 DOI `10.1038/nature14539`，Crossref 与 OpenAlex 的精确接口均返回 `Deep learning`。测试还证实把 DOI 作为普通全文搜索词会返回无关结果，因此客户端已修正为 DOI 专用查询。Semantic Scholar 对该测试 DOI 返回 404，客户端按未找到处理，不伪造候选；其带 key 的访问仍需用户配置自己的凭据验证。未使用真实 MinerU 付费 key。

### 补充恢复约束

同一任务中断后立即继续时，会等待旧运行结清再开始新运行，避免旧取消事件覆盖新任务。网络重试的可见草稿按请求替换，不拼接多个未完成 JSON。


阅读模式截图：`tmp/mineru-reading-mode.png`（本地审阅生成物，不提交仓库）。

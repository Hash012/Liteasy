# 推荐 PDF 下载与 MCP 批量导入

## 修复原因

推荐页此前用 `openAccessPdfUrl || openAccessAvailable` 判断按钮是否可用；只有题录和 DOI 的 Crossref 结果在全文解析前就被禁用了。下载客户端也在缺少这两个字段时直接返回空值。

现在点击下载会按论文身份解析可用 PDF，复用同一套本地保存接口供 MCP 使用。不会按相似标题随意下载其他论文，也不会把仅题录或出版社登录页伪装成 PDF。

## 下载与保存

- 已知 PDF、arXiv 标识、ACL/OpenReview 页面可优先尝试直接全文。
- DOI 对应的 Crossref、OpenAlex 和 Semantic Scholar 精确记录提供补充全文位置。配置过的文献服务地址与密钥继续可用；无 Liteasy 登录也可以下载公开论文。
- 解析论文页面的 `citation_pdf_url` 等元标签与明确的 PDF 下载控件，支持相对地址、实体编码和 HTTPS 跳转。部分题录记录使用旧 HTTP 链接时尝试 HTTPS；不允许实际降级 HTTP，也不将服务密钥带到出版社。
- Crossref 的全文 `link` 不保证免费访问，OpenAlex 的 PDF 也不一定在 `best_oa_location`；失败的首选地址之后继续尝试其他已知位置。参考 [Crossref 全文链接说明](https://www.crossref.org/documentation/retrieve-metadata/text-and-data-mining/) 和 [OpenAlex 位置字段](https://help.openalex.org/data/locations/)。
- 每篇解析最多访问 10 个全文/页面地址，元数据响应 2 MiB、PDF 32 MiB；单篇总信号限时 90 秒，原生在途 HTTP 还受单请求超时约束。PDF 需以 `%PDF-` 开头，计算 SHA-256 后分块写入；HTML、拒绝访问和重复跳转不能形成伪文件。
- 下载到默认 `Download` 或用户选定的文献库目录，内容重复时沿用现有文件、不覆盖已有题录。能取得正式标题、作者、年份时随新文件保存。
- 无公开全文时说明实际失败；机构订阅、验证码和登录授权仍需从论文网站获取。

## MCP

新增 `liteasy_import_papers`、`liteasy_import_status` 和 `liteasy_cancel_import`；参数和示例见[本机 MCP 文档](2026-09-29-local-asset-mcp.md#批量论文导入)。后台任务支持 50 篇、逐项结果、幂等重试和取消。导入期间切换账号/目录、关闭或撤销 MCP 写入会阻止剩余任务落盘。

## 验证记录

2026-09-29 在开发环境使用真实解析器和代理 HTTP 适配器验证，未写入用户库：

| 入口 | 结果 |
| --- | --- |
| `https://proceedings.mlr.press/v235/das24a.html` | 成功解析 Larimar 的官方 PDF，1,383,025 字节，约 8.2 秒；取得标题与作者 |
| DOI `10.18653/v1/2025.findings-acl.706` | 成功下载 ACL PDF，835,959 字节，约 3.9 秒 |

回归覆盖没有预填 PDF 地址、被拒绝的首选地址、其他仓储位置、元标签链接、错配 DOI 拒绝、凭据隔离、取消暂存、MCP 只读/通知限制、任务重试、部分失败、权限和目录切换。另验证推荐页和 MCP 设置的浅/深色浏览器交互、前端构建与生成契约一致性。此变更不触发安装包流程；这些检查不等同于 Windows 安装包验收。

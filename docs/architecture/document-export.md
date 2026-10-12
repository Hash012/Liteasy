# 统一文档导出决策（2026-10-12）

基线：ac08379d8626847216f422306e36bb65916a0506。规格：Liteasy_Export_Spec_Pack proposal/v1.0。

## 范围与依赖

导出派生快照和文档树放在桌面 document-export feature，复用资源注册、ObjectRepository、AgentAssetService 和 research Markdown 安全 profile。它们不是正文仓库。冻结字节后不再读界面 DOM 或 latest；无法固定历史白板布局时拒绝历史空间导出。

共享 parser 使用 unified/remark GFM/math/frontmatter；frontmatter 作为字面元数据保留，不执行 YAML 或将其误排成标题。remark-frontmatter 为 MIT 的语法扩展，无平台 runtime。继续使用既有 rehype 安全 profile。直接声明使用的 parser/serializer 依赖，避免依赖偶然的传递安装。DOCX 使用按需加载的 docx 库（MIT），以真实 OOXML 段落、编号、表格、图片表达内容；不执行宏/OLE。数学支持和降级由诊断说明，不宣称所有公式可编辑。

PDF 选择 Windows 已有 WebView2 原生 PrintToPdf 驱动，避免分发第二个 Chromium/Node runtime。使用与 Tauri 锁文件一致的 webview2-com/windows 版本。其他宿主提供明确命名的系统打印，不能报告为后台 PDF 保存成功。隔离的静态文档禁止业务脚本、外网、任意 file URL。不得把开发依赖 Playwright 当安装版 runtime。原图片 PDF 仅作为明确命名的兼容回归路径。

## 成本与发布门禁

Windows 驱动复用已安装 WebView2 runtime，额外浏览器包增量为 0；新增 Rust 接口与 docx 前端代码的实际 installer 增量、cold/warm、RSS 仍需在最终 Windows 构建测量。WebView2 Evergreen 由系统维护；缺失/旧版本须返回不可用原因。没有 Windows 安装版离线验收前，不声称正式后端验收通过。macOS/Linux 原生后台 PDF、签名/公证和对应成本尚待平台实现，系统打印只属于降级能力。

使用本机字体必须报告系统字体限制，不能宣称跨设备字体完全一致。没有随包字体许可文件，不能凭空承诺固定中文字体/全字形覆盖。PDF/A、PDF/UA、Word 精确分页均不在能力声明中。

## 发布与历史

文件先在目标同目录 create_new 写入、sync，再平台原子替换。文件已发布而历史失败返回 saved + history_write_failed。浏览器下载返回 download_started。格式、扩展名、MIME 和打包形式采用穷尽映射。历史写入独立 v2 文件/浏览器键，读取旧 v1 且不覆盖原记录；未知未来格式保留原字段并只读显示，不能清空整份历史。

## 原生入口

生成式 Canvas：ArtifactTabs → ArtifactExportMenu → useArtifactExportController → document-export 编译/序列化 → artifactExportClient。
工作区白板：ObjectWorkbench → useObjectWorkbenchController → createCanvasArchive（原生 ZIP）；阅读报告另由固定白板/成员模型编译。论文原文件复制、账户/学术画像导出保持各自原生语义。未调查的插件第三方导出入口标记 unknown，不推断其实现。

本机 CLI：`Liteasy --agent-cli document-export --input source.md --format pdf|markdown|docx|html --output report.ext [--overwrite true]`。输入明确的 UTF-8 Markdown 文件及同目录授权图片，复用 GUI 编译/序列化和原子发布；不启动模型。带图片 Markdown 的输出扩展名必须为 `.zip`。CLI 暂不提供论文库/白板资源路径适配。

空间图集已有模型坐标平铺和完整正文附录，混合纸张、连线跨页优化与旋转来源仍需专项验证。PDF 目录书签、页码页脚、宽表列组重排、持久化中断任务账本、全公式局部图回退尚未完成，不能把本次改动称为规格全部验收。

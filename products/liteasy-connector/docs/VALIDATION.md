# 验证记录 · 2026-09-30

版本：0.1.0。构建目标：Chrome / Edge Manifest V3。Node 使用桌面 `.nvmrc` 指定的 22.23.2。

已通过：

- 27 项迁移模块回归：阅读身份与进度合并、取消已读的墓碑记录、批注并发保存与恢复草稿、来源迁移、白板 Canvas 类型/尺寸/连线验证、白板 CAS 冲突恢复、分页、回收站恢复。
- 3 项文献核心测试：DOI / URL 去重、元数据和附件 URL 验证、BibTeX / RIS 内容与转义。
- TypeScript 类型检查与完整扩展构建。
- 5 项原生 Chromium 扩展测试：
  - 真实 translator 沙箱返回论文元数据，SingleFile 生成无原始脚本的 HTML 快照，下载 PDF；重复采集不新增重复条目；专用 Worker 导出含约 450 KB PDF 的 ZIP 并核对内容。
  - ChatGPT 已读勾选经刷新恢复；批注 Markdown 和公式预览、脚本净化、笔记转白板、标准 `.canvas` 导出、刷新后恢复；420px 宽工作区没有水平溢出。
  - 网页 content script 无权读取文献库，浏览器内部页面被明确拒绝；Zotero 保存传输入口被禁用。
  - 批量搜索结果只保存勾选条目；取消后不写入；搜索结果页不会被保存为某篇论文的快照。
  - 随扩展打包 748 项固定版本官方 translator；禁用远程规则服务后，使用真实官方规则识别 Highwire 论文元数据。页面自动识别与立即采集共享串行队列，避免 MV3 沙箱实例被并发重置。
- Manifest 的 62 个入口/资源引用均存在，版本与 package-lock 根版本一致，Google Docs 注入及 CSL 重定向未启用。
- 安装 ZIP 与对应源码 ZIP 完整性检查通过；源码包解压到独立目录，使用锁定依赖重建，得到的 1,104 个扩展文件与安装 ZIP 逐字节相同。构建不依赖上游 `.git`，仍校验固定提交及文件哈希。
- `git diff --check`。

测试侧载生产构建到独立浏览器配置，使用真实 service worker、content script、extension CSP、IndexedDB、Markdown Worker 和浏览器下载。测试数据服务器、ChatGPT 页面和 translator 仓库是测试夹具；不登录或修改用户账号。截图由测试生成在 `test-results/library.png`、`test-results/whiteboard-side-panel.png`，不提交运行生成物。

边界：没有在真实登录态 ChatGPT、所有出版社、Windows Edge 或浏览器商店签名环境逐一验收；没有测试桌面自动同步，因为 Liteasy 桌面尚无此接收接口。附带源码包按固定的上游提交和子模块重建，来源见 `upstream.lock.json`。

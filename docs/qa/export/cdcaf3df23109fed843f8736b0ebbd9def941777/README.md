# 文档导出验收记录

基线 `ac08379d8626847216f422306e36bb65916a0506`；隔离验证提交 `cdcaf3df23109fed843f8736b0ebbd9def941777`。它位于本地临时 worktree，原分支未移动；原工作区修改未被提交。此目录记录本次实现和证据，**不是规格全部验收通过**。

[逐项结果](acceptance-results.json) 覆盖 E01–E53，共13项PASS，其余专项NOT_RUN；[环境及输入哈希](environment.json)、[产物哈希](sha256.json)、[实际原生保存回执](native-receipts.json) 可交叉核对。回执去除了本机输出路径；输入都是可公开的合成材料。

## 实际内容证据

- E03：[真实生产兼容PDF](orientation.pdf)，真实JPEG通过PDF.js/MuPDF/Poppler，红上蓝下且三角朝上。[检测结果](orientation-results.json)。默认新PDF不再调用图片PDF。
- E04：[Windows原生PDF](windows-report.pdf)，WebView2 154.0.4258.62，两页含可见正文、语义表格/公式与末段。[文本](windows-report.txt)、[第一页](windows-page-1.png)、[图片页](windows-page-2.png)。MuPDF和Poppler实际读出正文尾标记，方向检测见[native-reader-results.json](native-reader-results.json)。
- [Chromium实际打印PDF](research-report.pdf) 来自生产HTML，含混合内容、静态Mermaid、代码尾标记；这是浏览器打印证据，不充当Windows安装版证据。
- E35/E37：[Markdown资源ZIP](windows-report.zip)、[可编辑DOCX](windows-report.docx) 从同一固定源生成。ZIP移动到新目录后图片仍可读；DOCX测试解包验证真实OOXML。Word/WPS/LibreOffice打开验收尚未运行。

## 重跑命令

桌面目录，Node使用 `.nvmrc`，依赖 `npm ci`：

```bash
npm test
npm run ci:export
npm run ci:smoke
npm run build
# 仅在干净提交上运行
npm run ci:contracts
EXPORT_EVIDENCE_DIR=/absolute/output npx playwright test src/tests/browser/artifactExport.browser.spec.ts
EXPORT_EVIDENCE_DIR=/absolute/output npx vitest run src/tests/artifactPdfOrientation.test.ts
```

Rust版本来自Windows workflow；宿主回归：

```bash
cargo +1.98.1 check --locked --all-targets --no-default-features --manifest-path products/liteasy/apps/desktop/src-tauri/Cargo.toml
cargo +1.98.1 test --locked --no-default-features --manifest-path products/liteasy/apps/desktop/src-tauri/Cargo.toml artifact_export::tests
cargo +1.98.1 test --locked --no-default-features --manifest-path products/liteasy/apps/desktop/src-tauri/Cargo.toml object_store::tests
cargo +1.98.1 test --locked --no-default-features --manifest-path products/liteasy/apps/desktop/src-tauri/Cargo.toml document_export_cli::tests
bash .github/scripts/lint-workflows.sh
node --test .github/scripts/*.test.mjs
```

Windows 11 Pro 26200，Rust1.98.1：前端先真实build，再 `cargo build --locked --features custom-protocol --manifest-path products/liteasy/apps/desktop/src-tauri/Cargo.toml`，运行隔离开发profile下的exe：

```text
liteasy-desktop.exe --agent-cli document-export --input windows-input.md --format pdf --output windows-report.pdf
```

同一命令分别运行html/docx/markdown（有附件时输出.zip）。显式 `--overwrite true` 才允许替换已有目标；不得指向源文件。GUI与CLI共享编译/序列化/原子保存，CLI目前仅支持明确本地Markdown及目录内授权图片。

复查所交付文件（Python环境需PyMuPDF与Pillow，独立reader为Poppler）：`python verify.py`。脚本不执行文档内容或包内probe，只读取本目录合成产物。

## 检查结论与实际限制

完整桌面回归：553文件通过，3844测试通过，3文件/7测试为既有跳过项。导出49测试和3AST负例通过；浏览器2测试通过；smoke/build/contracts通过。Rust导出10、对象存储9、CLI2测试通过；Linux和真实Windows的locked all-targets/no-default检查通过。原始完整日志保留在本地tmp，公开目录存摘要和哈希，其他日志已去除工作区绝对路径。

保留原生Canvas ZIP、原文件出口和明确命名的兼容图片PDF。新导出读取保存模型，不对当前DOM截图；源状态未固定时报告legacy-unpinned，不伪造版本。

系统字体尚未固定/授权随包，回执明确system-fonts/unverified。macOS/Linux后台PDF未实现。生成式UI的live dataSources拒绝，科学3D/交互图静态快照仍有限。矩阵等DOCX公式目前经同意保留原TeX，没有全面局部图回退。空间图集混合纸张与跨页边专项未验收。

宽表列组重排、超高单元格重排、PDF书签/页脚、portable Markdown profile、选区父块扩展、持久化中断任务账本尚未完成。完整敏感元数据/重定向/旋转EXIF安全与布局矩阵未验收。

Windows实际debug宿主成功运行，**没有运行最终Release/NSIS安装包离线/新用户验收**。WebView2复用系统runtime，不新增第二个浏览器包；实际installer增量、cold/warm、峰值RSS均NOT_MEASURED。未发布PR或远程安装包。

排查期间一次初始about:blank打印被正文校验拒绝；随后精确data导航白名单修复并产生上述正文PDF。退出时WebView2偶有Chrome_WidgetWin_0注销错误1412，但输出/进程退出成功；此异常保留记录，未用其掩盖失败。

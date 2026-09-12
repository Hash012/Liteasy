# PDF 文本选区修复

分支：`fix/text-selection`。独立工作目录：`/home/tjm/proj/Liteasy-text-selection`。原目录同时进行 `fix/UI-improvements`，本次修改已从该目录移出，避免混入速问等功能。

## 原因与方案

1. PDF.js 文本层采用替代字体，再按整个文本项的宽度缩放。每个字符的 DOM Range 宽度不一定等于 PDF 实际字形的 advance；内部字符边界会偏移。
2. 原逻辑正向拖选词尾时使用 20% 阈值，反向和其他字符使用中点，造成方向相关的额外扩选。
3. 高亮样式在左右额外扩展 0.1% 并使用负 margin，使显示范围进一步偏离保存的矩形。
4. 滚动切换 focused page 会重绘 PDF 和文本层，可能在拖选中清除字符模型。

参考原目录 `tmp/zotero/reader/src/pdf/selection.js` 的字形边界、中点与统一区间原则，以及 `native-text-selection-map.mjs` 的 Unicode 映射与端点一致性原则。本次独立实现适配当前 PDF.js，无新增依赖或复制 Zotero 的完整阅读器。

优先从 PDF.js 已解码绘制操作读取字形宽度、字符/词间距、TJ 调整、文本矩阵、缩放、旋转和表单变换，投影到页面百分比坐标。每个文本项须完整文字匹配且位置相符，才替换 DOM 几何。联字的 Unicode 展开保留为一个可选字形，保证高亮与复制使用同一段内容。无法可靠匹配的文本、竖排或 Type3 字体继续使用原 DOM 测量，不猜测其他位置的字符。

统一使用字符中点；取消词尾扩选及高亮横向扩边。预览、复制、批注、交给 Agent 的文本都来自同一个逻辑区间。滚动聚焦与证据覆盖层更新不再重建 PDF 文本层。

字形信息按 PDFPageProxy 缓存，缩放复用百分比坐标；没有新增本地原生依赖，Windows WebView 使用同一实现。未声称已运行 Windows 安装包；本地生产构建后仍需 GitHub Actions 验证。

## 验证

- 单元回归覆盖 PDF 字形宽度、Tc/Tw/TJ、变换和行移动、旋转、重复文字、联字及降级路径。
- 浏览器使用已知字形坐标的自制 PDF，覆盖 80%/100%/120%、正反向选择、复制与保存后重新载入一致性。
- 真实 Larimar PDF 覆盖双栏起选、词尾、高亮注释编辑。
- 最终 `npx vitest run src/tests/pdf src/tests/Pdf src/tests/ReaderPane.test.tsx`：17 个测试文件、172 项测试通过。
- 最终 Playwright `pdfSelection.browser.spec.ts` 与 `readerPresentation.browser.spec.ts`：7 条流程通过，包含缩放后搜索高亮刷新。
- `npm run build`：TypeScript、Vite 生产构建、Tauri 资源与 151 个生产资源文件检查通过。
- 无新增 Rust 代码或依赖；本次未执行 Windows CI，未自动 push。

# C08 / C09：PDF 缩略图资源与键盘焦点切片

2026-10-02，从 `0fba97be` 隔离实施；仅修改 PDF feature 叶模块及其测试。此报告不是整张 C08/C09、原生无障碍或跨平台性能验收。

## 先复现再修改

新增的 7 个单元回归最初全部失败：关闭缩略图没有调用 PDF.js 页面资源清理，取消后才完成的 `getPage` 也未清理；50 次挂载/卸载留下 50 个未释放页面缓存；输入法组合期间 Enter 触发查找/跳页，Escape 关闭查找；关闭查找后焦点落到 body；Mac 提示仍显示 Ctrl。

在真实 Chromium 的独立开发测试页面中，再次测得 3 轮、每轮 50 个真实 PDF 缩略图挂载/关闭后，均保留 50 份 PDF.js operator list（共 300 个 operator）。原有 canvas 已正确缩至 1×1，问题位于 PDF 页面缓存，不用改写渲染队列或增加新缓存来解决。

`PdfThumbnail` 现在在卸载/不可见/参数切换时取消任务、清理页面缓存并缩小 canvas；如果 `getPage` 在取消后才完成，异步路径同样清理。复用 PDF.js 的 `cleanup()`，其本地依赖源码会在仍有 render task 时延迟清理。没有销毁其他读取者共享的 PDFDocument，也没有移除缩略图或正文功能。

`PdfReaderToolbar` 在查找和跳页键盘处理时忽略 `isComposing` / keyCode 229，进入查找前记录焦点，关闭后返回原触发位置；Mac 提示复用已有 workbench 平台判断。`PdfReader` 的 Ctrl/Command+F 也不会截获组合输入。

## 浏览器实测

WSL2 Ubuntu 24.04.3 x86_64；AMD Ryzen 9 7940HX，32 个可用逻辑处理器，WSL 内存约 23 GiB。Chromium `151.0.7922.34`，真实 PDF.js worker/canvas；Node `22.13.1`。测试 fixture 为代码生成的 8,156 字节、50 页英文纯文本 PDF。它是小型合成文件，不代表扫描件、巨型 PDF、低配机器或真实用户库。

独立 fixture `src/tests/browser/pdf-lifecycle-fixture.html` 只由开发服务器提供；没有加入 App/生产入口。生产资源检查通过，构建 JS 不含 fixture 的全局入口。测试代码观察 PDF.js `_intentStates`，这是测量内部缓存而非新增产品 API；依赖升级时需要重新核验该探针。

| 测量 | 修改前（3 轮） | 修改后（3 轮） |
| --- | --- | --- |
| 每轮 50 次关闭后 operator list | 50 / 50 / 50 | 0 / 0 / 0 |
| 每轮残留 operator 总数 | 300 / 300 / 300 | 0 / 0 / 0 |
| 单 canvas 峰值像素 | 16,950 | 16,950 |
| 50 个关闭 canvas 的总 backing pixels | 50 | 50 |
| 热缩略图 P50，每轮剩余 49 页 | 16.5 / 16.5 / 16.5 ms | 16.5 / 16.4 / 16.5 ms |
| 热缩略图 P95 | 16.9 / 17.0 / 17.0 ms | 16.9 / 17.1 / 17.0 ms |

修改后另外确认 3 个真实 worker 启动、3 个结束、剩余 0 个。首次文档解析和首缩略图时间逐轮保存在 JSON；每轮创建新 document/worker，第二、三轮复用已加载模块和浏览器缓存。它不是应用冷启动指标，也不是严格控制机器负载的速度比较。缩略图时间受约 60 Hz 的浏览器帧调度限制；本次结论是残留缓存清零，没有声称变快或精确回收多少进程内存。

真实应用的 PDF 导航浏览器回归通过。键盘进入查找、组合输入期间 Escape、正常关闭返回搜索按钮、Ctrl+F 从阅读区进入并返回阅读区，分别在 125%、150%、200% CSS zoom 通过。组合事件为自动派发，不代表实际中文 IME 设备测试；CSS zoom 不代表系统 DPI/多屏验证。首轮 125% 测试曾在文档仍加载时触发 5 秒文本断言失败；增加明确的 PDF response 就绪等待后通过，未改 timeout、未跳过断言。

## 命令与范围

详细执行结果见 `C08-C09-verification.json`。单元测试使用 jsdom、PDFPageProxy 模拟对象；浏览器使用真实 PDF.js/worker/canvas，固定合成 PDF 响应。没有真实 Tauri IPC 或原生窗口测试。

```bash
npm ci --offline
npm test -- --run src/tests/pdfThumbnailLifecycle.test.tsx src/tests/PdfReaderToolbarKeyboard.test.tsx src/tests/PdfReaderInteraction.test.tsx src/tests/PdfReaderPublication.test.tsx
npm run ci:smoke
npm run build
npm run ci:contracts
# 在本 worktree 启动 Vite 1429，避免复用其他分支服务器：
PLAYWRIGHT_BASE_URL=http://127.0.0.1:1429 node_modules/.bin/playwright test src/tests/browser/pdfLifecycleBudget.browser.spec.ts src/tests/browser/pdfKeyboardFocus.browser.spec.ts src/tests/browser/pdfNavigation.browser.spec.ts --workers=1
```

没有更改资源/文献持久化、共享 schema、锁文件、版本、AppShell、生产服务或 CI。回退代码只撤回清理和键盘行为修正，不需要数据迁移。

尚未验证：完整应用冷/热启动、10k 元数据查询、六窗格、长对话、50 次原生文档窗口/进程树内存、空闲 CPU、低配硬件、OCR/索引取消、Windows NVDA、macOS VoiceOver、Linux 辅助技术、真实 IME、系统缩放/多屏、伪本地化及切语言内容不变性。C08/C09 仍为有界部分完成，`release_ready=false`。

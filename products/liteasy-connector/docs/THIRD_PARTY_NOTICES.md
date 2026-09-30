# Third-party code / 第三方代码

本包的渲染依赖全部位于 `vendor/`，随扩展本地分发，不通过 CDN 下载、远程 import 或运行时 npm 安装。测试适配层不在 Manifest 的生产入口中。

| 组件 | 实际打包版本 | 来源与改动 | 许可证 |
| --- | --- | --- | --- |
| Marked | 4.0.19 | 容器预装 nbclassic 的 `static/components/marked/lib/marked.js`；原样复制 UMD 文件。版本由该目录的 `package.json` 确认。 | `vendor/MARKED-LICENSE.md`，保留上游完整声明 |
| Prism | 1.30.0 | 容器预装 npm `prismjs`；拼接 core 与 16 个语言组件，开头设置 `manual: true, disableWorkerMessageHandler: true`。 | `vendor/PRISM-LICENSE.txt`，MIT |
| KaTeX | 0.16.27 | 容器预装 Gradio 的自包含 `katex-XbL3y5x-.js`；保留实现，将尾部 ESM 导出改为 Worker 全局 `katex`，加 IIFE 包装；输出使用 MathML。 | `vendor/KATEX-LICENSE.txt`，MIT，版权行经 v0.16.27 上游 LICENSE 核对 |

Prism 语言：markup、css、clike、javascript、typescript、python、c、cpp、rust、sql、bash、json、yaml、java、go、diff。组件内提供的别名可用；未打包语言不自动联网下载。

没有包含任何字体文件、DOMPurify、Mermaid 或远程依赖加载器。`markdown-view.js` 的安全处理是本项目自己的正向允许列表 DOM 重建，不冒称使用 DOMPurify，也不声称已经覆盖所有可能的安全漏洞。

这些是本包锁定并实际验证的版本，不声称是最新版本。升级渲染器时需要同步检查 API、许可证、安全预算及脚注/公式扩展，并重新运行 Markdown 与 XSS 测试。

## Primary references（2026-09-15 核查）

- Chrome Side Panel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Marked documentation and output sanitization warning: https://marked.js.org/
- KaTeX rendering/security options: https://katex.org/docs/options.html
- KaTeX v0.16.27 license: https://raw.githubusercontent.com/KaTeX/KaTeX/v0.16.27/LICENSE
- IndexedDB transactions: https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction

包内文件哈希见 `tests/source-sha256.json`。许可证文本本身是上游允许分发的条款；各依赖的版权归相应作者所有。

# C03 · PDF 阅读位置恢复切片

实现提交：`ec7e7d23`，基线：`ca80f7db`。本报告仅覆盖 PDF 页码保存与显式重新打开后的恢复，不代表 C03 整卡完成。

## 用户行为与存储

打开 PDF 后，翻页、目录/搜索/批注跳转和连续滚动会保存当前页码。关闭并再次**显式选择、重新授权**同一份原位置 PDF，加载完成后回到保存页；不会重建原生 grant，也不会自动打开旧文件。打开动作不改写、复制或上传原 PDF。

复用账号隔离的 `object_store`，键为 `reader-state/pdf/<paperId>`；原生实现已有 SQLite，浏览器实现已有 IndexedDB。记录只包含版本、paperId、内容修订、页码和更新时间，没有原路径、grant 或凭据。原位置 PDF 的 paperId 和内容修订来自完整字节 SHA-256，重新选择同字节文件获得的新 grant 不影响位置。没有 contentHash 的旧资料条目使用 PDF.js 的原始及修改 fingerprint 联合标记；PDF ID 不是完整内容哈希，不承诺识别错误复用 PDF ID 的外部改写。

只有当前 paperId、路径、contentHash 与已加载 proxy 一致时才恢复。加载期间不会把初始第 1 页写回；已保存页码超过当前页数时限制到末页。显式用户导航、证据跳转优先于迟到的存储读取，已排队的恢复滚动也能被取消。恢复采用即时滚动，并忽略恢复过程的中间 scroll 事件。

同一 renderer 内按 scope 与 paperId 串行写入；每次写入重新读取、校验旧记录，再使用现有乐观事务。损坏记录、未来 schema、读失败或 CAS 冲突不会被空记录覆盖；界面提示位置尚未恢复/保存，当前打开期间停止写该记录，重新打开可重试。此切片不增加跨窗口冲突合并策略。

完整本地 profile 备份已包含 `reader-state/`。恢复回归检查当前版本和未知未来版本的原始 value/version 均原样保留，并继续隔离其他 scope。原位置文件本身仍需重新授权；恢复包已有的受管文献可以正常打开。

## 实际验证

环境为 Ubuntu 24.04.3 x64 / WSL2，Node 22.13.1（仓库要求 22.23.2）、Rust 1.98.0（Windows workflow 要求 1.98.1）、Chrome for Testing 151.0.7922.34。依赖使用 `npm ci --no-audit --no-fund`，未更新锁文件或共享 schema。

在 `products/liteasy/apps/desktop` 执行：

```sh
npm test -- --reporter=dot src/tests/PdfReaderPosition.test.tsx src/tests/pdfReaderPositionStore.test.tsx
npm test -- --reporter=dot src/tests/originalFileService.test.ts src/tests/PdfReaderInteraction.test.tsx src/tests/PdfReaderToolbarKeyboard.test.tsx
npm run ci:smoke
npm run build
npm run ci:contracts
cargo test --locked --no-default-features --manifest-path src-tauri/Cargo.toml --test local_recovery
cargo check --locked --all-targets --no-default-features --manifest-path src-tauri/Cargo.toml
node scripts/verify-pdf-reader-position.mjs
```

- 新增 15 条用例通过；原文件、现有 reader 交互及键盘的受影响 19 条通过（首次合并执行 30 条时新增用例为 11 条，随后新增 4 条再次执行通过）。组件测试使用 PDF.js proxy 和存储替身，显式覆盖新 grant/同内容恢复、旧 proxy 不得读取或写入新 paper、证据优先、晚到读取、同路径换修订、账号切换、损坏/未来 schema、CAS 与写入次序。
- smoke 9 条、生产构建通过；构建保留既有大 chunk 提示。干净实现提交 `ec7e7d23` 的 contracts 通过，无生成文件/锁漂移。
- Rust 恢复回归先因 `reader-state` 恢复行数为 0 失败；加入前缀后 7 条通过。显式 GUI fixture driver 仍默认 ignored，未用此次测试声称 GUI 验收；locked all-targets check 通过。
- 可重复的浏览器脚本启动受限 loopback Vite，运行真实 PDF.js、真实 IndexedDB 和合成六页 PDF。实际翻到第 4 页，等滚动完成及页码写入后 reload，确认第 4 页和连续模式滚动位置恢复；`scrollTop=5036`，页面异常为 0。没有原生 IPC，grant 为合成输入。若 Chromium 不在默认缓存，用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向已安装的浏览器；本次路径为 `/home/tjm/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`。

本次日志：`/tmp/liteasy-c03-position-final-focused.log`、`/tmp/liteasy-c03-position-focused.log`、`/tmp/liteasy-c03-position-browser-repro.log`、`/tmp/liteasy-c03-position-{smoke,build,contracts,recovery-red,recovery-green,cargo-check}.log`。日志与截图不是仓库验收产物；脚本和测试可重新生成结果。

## 未验证与回退

本切片尚未运行真实 Tauri 重启重新选文件的页码验收、Windows/macOS、安装器、磁盘满、进程强杀或跨窗口同时翻页。浏览器 reload 的结果不能代替这些验证。保存完成前退出仍可能丢失最近一次异步位置写入；测试会等待实际提交。

位置只恢复到页，不恢复页内像素、缩放或自动打开。新 schema 不迁移或删除旧记录；回退代码会忽略 `reader-state/` 行，已有资料与批注不受影响。下一项最小验收是在真实 Tauri 窗口中打开合成 PDF、翻页、等待保存、退出、重新授权同一文件并核对页码和批注。

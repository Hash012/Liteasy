# C08 第一片：停止文件读取引起的重复扫描

基于 C02 的 `5a3411e9`，独立分支 `feat/client-c08-watch-budget`。本片来自 C00 的真实原生观察，不是无依据的重构。

## 问题与修复

Linux notify/inotify 会报告 Open、Read、Close(Read)。现有监听回调不分事件类型，自己的目录扫描和 PDF 读取又被当作变化加入队列，形成持续扫描；C00 真实窗口日志共出现大量全量校验回退。本片从回调提取统一判定，忽略无写入的访问和自身原子写临时文件，保留 Create/Modify/Rename/Remove/Close(Write)。notify 标记事件丢失、即使没有路径，也请求完整校验。没有用加长 debounce、关监听或静默吞错掩盖问题。

新增反例先在旧判定下失败；本片通过 51 项 Rust 文献库测试、2 项前端库监听测试、8 项 smoke、locked Rust check 和生产前端构建。Rust 无默认 feature 测试不冒充实际窗口操作，后者另行执行。

## 实际原生复核

Ubuntu 24.04 x64 / WSL2 / WSLg X11，AMD Ryzen 9 7940HX（32 个逻辑 CPU），WebKitGTK 2.52.6。控制台提示 DRI3 硬件加速不可用。这不是 Windows/native Linux 物理机性能验收。

在新隔离 profile 复制同一份 667 字节合成 PDF，真实桌面双击阅读。通过外部文件操作增加同内容第二份文件，列表 1→2；将第二份改为中文文件名，列表自动更新。过程无需手动刷新，PDF 保持可读；全量校验回退日志计数为 0。原件哈希与 C00 相同。

本机临时截图 `/tmp/liteasy-c08-native-two.png`、`/tmp/liteasy-c08-native-renamed.png`，日志 `/tmp/liteasy-c08-native-fresh.log`；运行生成物不提交。

原生进程树（主进程、WebKitNetworkProcess、WebKitWebProcess）采样使用 `/proc` CPU tick / elapsed / CLK_TCK 与 RSS；Vite/cargo 不计入，RSS 相加会重复计算共享页。打开/新增文件期间的首轮三个连续 5 秒样本为 136.58%、43.91%、38.55% 单核 CPU；随后含一次重命名的样本为 46.58%、33.20%、33.39%，RSS 约 1.23 GB。它们不是三个独立冷启动，不用于宣称 P50/P95 达标。静置最终样本另见 verification 报告。资源占用偏高，尚需定位 WebView 活动与渲染成本；不应把消除一个循环等同“轻量阅读已经达标”。

复用其他 worktree 的旧开发 WebView profile 曾出现绝对模块 URL 缓存失效，改用新隔离 profile 后恢复。保留该限制；不能把这次缓存问题混作产品 Windows 故障。初始窗口 focus 先于数据目录初始化时还有一次 watcher resume 提示，setup 后监听正常，后续平台启动顺序切片应消除该提示。

## 兼容与下一步

没有 schema、文件布局或网络服务变更；无需迁移，回退仅恢复旧事件判定，但会重新出现 Linux 读取事件循环。未来仍需 C08 的冷/热独立重复基准、10k 查询、50 次开关文档、六窗格、长对话与 worker/canvas/URL 生命周期测量。此次没有安装、签名或升级验证。

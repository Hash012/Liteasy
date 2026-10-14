# 科研方法包

来源为用户提供的 `Liteasy_CS197_Skills_Starter_v0.1.zip`。`PROVENANCE.json` 保留原包的声明，描述的是交付给实现者的 starter，而非本仓库当前运行状态。包内十个方法的五个文件保留原始字节；catalog 中另外十四项仅作后续能力目录。

桌面适配器位于 `apps/desktop/src/app/features/research-skills/`。它将已校验的 manifest 注册到现有 workflow skill registry，绑定 `liteasy.research.generate-document@1.0.0`，使用现有模型网关、上下文快照、ArtifactTask、artifact resource provider 和 PaperProject。没有另一套执行器或会话存储。

摘要算法：按相对 POSIX 文件路径排序，对每个文件拼接 `path + NUL + sha256(fileBytes) + LF`，再计算 SHA-256。catalog 位于方法目录之外，不参与单个包摘要。`.gitattributes` 固定 LF，保证 Windows checkout 的字节与摘要一致。说明、约束与模板按选中方法懒加载；不执行脚本。

本阶段仅启用现有本地文档后端：桌面 JSON 原子写入与浏览器 IndexedDB。模型可使用现有云端或直连配置；存储不会因此改成 HTTP 服务。无 IndexedDB 的浏览器不接受科研文档写入。未启用正式 API/PostgreSQL 科研文档保存，后续须先完成该后端的故障注入验收。

验证与已知边界见 `docs/qa/research-skills/2026-10-14/README.md`。

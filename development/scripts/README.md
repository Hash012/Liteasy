# Repository scripts

仓库级只读检查与维护工具：

- `smoke-dev-cloud.mjs`：检查正在运行的本地开发 API。
- `verify-filesystem-release-evidence.mjs`：验证文件系统发布证据。
- `md-to-pdf.mjs`：调用 `development/tools/md-to-pdf` 转换文档。

脚本必须从仓库根目录可定位依赖，不写入产品源码目录；新增脚本应有同目录测试或在所属包中有聚焦测试。

## 运行与验证

从仓库根目录按用途执行：

```bash
# dev-cloud 必须已启动
node development/scripts/smoke-dev-cloud.mjs http://127.0.0.1:8787

# 校验一份发布证据 manifest
node development/scripts/verify-filesystem-release-evidence.mjs <manifest.json>

# 首次安装转换工具，再生成 PDF
npm install --prefix development/tools/md-to-pdf
node development/scripts/md-to-pdf.mjs <input.md> --output <output.pdf>
```

`<...>` 是调用者必须替换的路径，不要原样输入。脚本失败时返回非零退出码，可直接用于 CI 或验收记录。

## 开发测试账号

这些脚本不需要人员账号。smoke 只访问匿名健康检查和本地控制台外壳；发布证据校验与文档转换只读取调用者给出的文件。任何密码、token 或 API key 都不得作为命令行参数或写入结果文件。

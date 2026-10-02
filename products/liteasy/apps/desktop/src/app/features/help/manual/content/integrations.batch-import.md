## 准备
先连通本机 MCP，并打开写入权限。整理 DOI、arXiv 编号或 HTTPS 论文页面／PDF URL；不要只提供可能同名的标题。本次批量工具支持在线标识与网址，不扫描任意外部磁盘目录。

## 发起一批任务
使用 `liteasy_import_papers`，最多 50 篇。可指定当前文献库内的目标目录或新子目录；未指定时按该流程保存到 `Download`。

```json
{
  "operationId": "my-first-paper-import-01",
  "newFolderName": "研究测试",
  "papers": [
    { "arxivId": "2402.12482" }
  ]
}
```

示例标识只用于展示参数格式，不保证该站点在当前网络可下载，也不表示这篇论文适合你的主题。实际运行会访问外部网站。

## 查询结果
取得 `jobId` 后，用 `liteasy_import_status` 查询，直到所有条目不再是 queued／running。逐项区分 imported、duplicate、failed 和 cancelled，检查实际保存位置及返回的 Liteasy Path，再打开 PDF 验证。

同一 MCP 会话内，同一个 `operationId` 加相同参数返回同一任务；修改参数要使用新 ID。会话结束后任务历史不会永久保留，但 PDF 内容去重仍可避免相同内容重复导入。

## 取消和失败
使用 `liteasy_cancel_import` 停止未完成批次。已经保存的论文保留，正在提交的保存可能先完成；取消回执不是删除确认。

关闭 MCP、撤销写入、切换账号或数据目录会阻止后续工作。订阅限制、验证码、无公开 PDF、限流或传输失败应保持为该条失败，不用 HTML 或相似标题的另一篇论文替代。

## 重试前
先查询状态和文献库，再只处理失败项。创建笔记与导入任务的 operationId 都是为了安全重试，不是一个跨所有会话永久有效的全局去重服务。

# Fixtures

全部材料均为合成工程测试输入，不是论文原文，不得混入生产演示为研究事实。

- mixed-content.md：正文、GFM 表、跨行/跨列表头、数学、脚注、代码中的 HTML、Mermaid、Unicode。
- long-table.md：超过 4000 字符的完整 HTML 表，要求预算下保留结构或明确降级。
- incomplete-html-table.txt：模拟从属性中间开始的历史残片；不能自行修复成有事实保证的表格。
- hostile-content.md：安全测试；可读内容与危险操作分开。example.invalid 不应真正访问。
- unicode-crlf.md：CRLF 与 UTF-16/UTF-8 坐标区分测试。

重复读取测试请使用同一 canonical ref 和 revision 的不同范围；版本冲突测试保持 resourceId 不变并变更 revision。不要用两个同名文件模拟同一身份。

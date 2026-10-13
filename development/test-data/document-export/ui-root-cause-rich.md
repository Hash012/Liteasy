# UI 验收合成文档：DataLoader 阅读与排版

> 本文为离线合成测试输入，不是论文结论或外部证据。任何数字仅用于版式测试。

## 简要概览

这里是第一段正文，用来确认段落不会在屏幕或导出中被挤成一整块。A loader consumes a **batch**; the renderer should preserve Chinese, English, punctuation, and an `inline_code` token.

这里是第二段正文。测试讨论的是排版，不宣称某种数据加载方案优于另一种。文献与运行结果必须分别保留来源及状态。

### 机制与公式

合成例子使用 $T = T_{\mathrm{io}} + T_{\mathrm{decode}}$。下面是独立公式，不能在任意字符位置加入换行：

$$
\operatorname{throughput}(b) = \frac{b}{T_{\mathrm{io}}(b)+T_{\mathrm{decode}}(b)}.
$$

- 保留有序与无序结构，而不是用换行模拟所有内容。
- 嵌套示例：
  1. 固定输入。
  2. 修改一个变量。
  3. 记录失败结果，不能伪造成功。

### 表格中的富文本

| 场景 | 合成状态 | 说明 |
|---|---|---|
| **空目录** | `ready` + `[]` | 可以说没有已知关联项 |
| **尚未读取** | `unknown` | 不能当作零 |
| **读取失败** | `error` | 保留原因并允许重试 |
| **已有旧数据** | `loading` + previous | 标注为上次已知清单 |

### 代码必须逐字保留

```rust
fn read_batch(path: &str) -> Result<Vec<u8>, std::io::Error> {
    // 该行仅用于中英文代码字体和标点的回归测试。
    std::fs::read(path)
}
```

### 引用与脚注

> 这是一段测试引用。它不是某位研究者的话，不能生成一个虚假的作者与出处。
>
> 这是引用中的第二段，段落边界应该保留。

这句话包含脚注标记[^test]。普通链接只指向文档内部：[回到概览](#简要概览)。

[^test]: 脚注内容为合成文本，必须保留并可找到；目标不支持时给出明确降级，不无提示丢弃。

### 超长原始段落

这一段特意没有额外分段，用来验证系统不会在导出时偷偷请模型改写，也不会为了让截图好看而插入语义不明确的换行。界面可以指出源内容缺少结构，但应该把重排作为一个用户明确选择且可审阅的动作。这里继续添加较长文本，使自动分页发生在真实打印引擎，而不是发生在按字符数切分的程序中。正文中仍有 `path/to/a_resource.json` 与 $x_{n+1}=x_n+\Delta x$ 这样的结构，不能被随意拆断。不同渲染目标可以使用不同字号、行距与边距，但是内容、公式、代码和证据所表达的意思不能改变。即使源内容不够优雅，保留它也比无提示重写成看似漂亮的不同内容更加可靠。

### 超长不可断代码片段

`SYNTHETIC_CONTINUOUS_IDENTIFIER_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789`

### 明确缺失资源

![缺失图片应触发诊断而不是静默消失](assets/intentionally-missing-image.png)

## 结束标记

`END-OF-SYNTHETIC-DOCUMENT` 必须能在全量导出的最终文本中找到。

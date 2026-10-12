# 合成研究笔记：格式一致性回归

> 本文件为工程测试合成数据，不是 Larimar 论文摘录，也不代表真实实验结果。

**粗体**、*强调*、~~删除~~、行内代码 `std::vector<T>` 应有一致语义。行内公式 $a^2+b^2=c^2$ 不应影响源码位置。

## GFM 表格

| 方法 | 读取范围 | 合成数值 |
|:---|:---:|---:|
| A | 全文 | 11 |
| B | 选段 | 7 |

## HTML 合并表头

<table>
<caption>合成数据：只用于显示测试</caption>
<thead>
<tr><th rowspan="2" scope="col">方法</th><th colspan="2" scope="colgroup">编辑指标</th><th rowspan="2" scope="col">限制</th></tr>
<tr><th scope="col">数值 X</th><th scope="col">数值 Y</th></tr>
</thead>
<tbody>
<tr><th scope="row">方法 A</th><td>11</td><td>7</td><td>仅测试域</td></tr>
<tr><th scope="row">方法 B</th><td>9</td><td>8</td><td>不同条件，不直接排名</td></tr>
</tbody>
</table>

## 依赖型语法

这句话带脚注[^scope]，并使用一个远处定义的[内部参考][note]。

$$
\sum_{i=1}^{n}i=\frac{n(n+1)}{2}
$$

```html
<table><tr><td>这是代码，不能当真实表格</td></tr></table>
```

```mermaid
flowchart LR
  A[原始资源] --> B[结构片段]
  B --> C[共享视图]
```

- 列表第一项
  - 子项保留上下文
- 列表第二项

Unicode：中文 😀 𝑥 é。CRLF 与源码坐标测试另有文件。

[^scope]: 这些数字是合成示例，不能作为科研结论。
[note]: #gfm-表格

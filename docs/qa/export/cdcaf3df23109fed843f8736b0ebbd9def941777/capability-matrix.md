# 当前入口与能力矩阵

| 入口/类型 | 固定来源与范围 | PDF/HTML | Markdown | DOCX | 保留原生入口/限制 |
| --- | --- | --- | --- | --- | --- |
| 薄读 ArtifactTabs → ArtifactExportMenu → export controller | 保存文档、全文/节点/子树、明确证据篇幅；旧源报未固定版本 | Windows真实PDF，其他原生平台后台PDF不可用；浏览器系统打印 | 语义MD，附件相对ZIP | 可编辑正文/表/受支持OMML | 不自动生成未完成节点 |
| 通用回答/大纲/思维图/直觉图产物 | 固定已保存结构 | 静态语义/受控Mermaid局部图 | 同一IR | 同一IR | 并非所有科学/3D图有快照；缺失有诊断 |
| 生成式UIDsl | 消费已保存节点及字段 | 表/卡/控件静态说明 | 同一IR | 同一IR | live dataSources明确拒绝 |
| NotesPanel | ObjectRepository完整已保存正文 | 同上 | 同上 | 同上 | 不把编辑中草稿冒充已保存版 |
| 工作区白板 ObjectWorkbench | 单次布局事务+immutable成员对象；全文/所选placements | 阅读报告总览+全文+关系；空间图集已有平铺但专项分页未验收 | 阅读报告 | 阅读报告 | 原生Canvas ZIP继续可用；空间图集仅PDF/HTML |
| 注册resource type export能力 | 注册固定compile handler+格式集合 | 支持类型走同一renderer | 同上 | 同上 | 未注册类型显式unsupported，不靠资产类型switch猜测 |
| 本地CLI document-export | 明确UTF-8 Markdown源+同目录授权图片 | Windows同一驱动/HTML | 同一资源ZIP | 同一OOXML | 暂无资源URI/论文库/白板CLI adapter |
| 论文原文件/账户画像等原生导出 | 既有入口语义 | 不伪装为统一报告 | 不伪装为统一报告 | 不伪装为统一报告 | 保留原逻辑；第三方插件入口unknown |
| 旧兼容图片PDF | 明确命名Compatibility函数 | 方向已修复，仍为图片PDF | 不适用 | 不适用 | 不作为新默认报告，不承诺搜索正文 |

全部报告新来源以派生快照/IR承载，不另建canonical正文仓库。不支持的格式或静态图能力应拒绝/预检诊断，不从标题和界面截图推断内容。

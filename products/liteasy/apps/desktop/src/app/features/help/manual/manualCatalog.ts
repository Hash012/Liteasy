// Generated from manifest.json + content/*.md. Run: node scripts/generate-manual-catalog.mjs
import type { ManualRecord } from "./manualProvider";
import type { HelpTopic } from "../help.types";
import body0 from "./content/getting-started.basics.md?raw";
import body1 from "./content/getting-started.install.md?raw";
import body2 from "./content/getting-started.modes.md?raw";
import body3 from "./content/getting-started.workspace.md?raw";
import body4 from "./content/reading.import.md?raw";
import body5 from "./content/reading.organize.md?raw";
import body6 from "./content/reading.metadata.md?raw";
import body7 from "./content/reading.pdf.md?raw";
import body8 from "./content/reading.selection.md?raw";
import body9 from "./content/reading.translate.md?raw";
import body10 from "./content/reading.ebooks.md?raw";
import body11 from "./content/reading.notes.md?raw";
import body12 from "./content/reading.vault.md?raw";
import body13 from "./content/boards.basics.md?raw";
import body14 from "./content/boards.research.md?raw";
import body15 from "./content/agent.chat.md?raw";
import body16 from "./content/agent.context.md?raw";
import body17 from "./content/agent.thin-reading.md?raw";
import body18 from "./content/agent.artifacts.md?raw";
import body19 from "./content/agent.prompts.md?raw";
import body20 from "./content/agent.quality.md?raw";
import body21 from "./content/agent.extensions.md?raw";
import body22 from "./content/discovery.recommendations.md?raw";
import body23 from "./content/discovery.personalization.md?raw";
import body24 from "./content/discovery.download.md?raw";
import body25 from "./content/discovery.profile.md?raw";
import body26 from "./content/preferences.appearance.md?raw";
import body27 from "./content/preferences.shortcuts.md?raw";
import body28 from "./content/preferences.settings-map.md?raw";
import body29 from "./content/data.locations.md?raw";
import body30 from "./content/data.backup.md?raw";
import body31 from "./content/sync.webdav.md?raw";
import body32 from "./content/sync.conflicts.md?raw";
import body33 from "./content/sync.secrets.md?raw";
import body34 from "./content/sync.cloud.md?raw";
import body35 from "./content/integrations.local-mcp.md?raw";
import body36 from "./content/integrations.batch-import.md?raw";
import body37 from "./content/integrations.mobile.md?raw";
import body38 from "./content/reading.chatgpt-review.md?raw";
import body39 from "./content/security.data.md?raw";
import body40 from "./content/security.permissions.md?raw";
import body41 from "./content/troubleshooting.start.md?raw";
import body42 from "./content/troubleshooting.models.md?raw";
import body43 from "./content/troubleshooting.reading.md?raw";
import body44 from "./content/troubleshooting.sync.md?raw";
import body45 from "./content/troubleshooting.report.md?raw";
import body46 from "./content/reference.glossary.md?raw";
import body47 from "./content/reference.limits.md?raw";
import body48 from "./content/reading.references.md?raw";

export const manualContentVersion = "2026.10.02.2";
export const manualBaseline = "c37bb2f0fde9fca8dd8dbbc409cb8cfeea030c7a";
export const manualTopics = [
  {
    "id": "getting-started",
    "title": "开始使用",
    "order": 0
  },
  {
    "id": "reading",
    "title": "文献与阅读",
    "order": 1
  },
  {
    "id": "boards",
    "title": "笔记与研究白板",
    "order": 2
  },
  {
    "id": "agent",
    "title": "AI 与助手",
    "order": 3
  },
  {
    "id": "discovery",
    "title": "发现与推荐",
    "order": 4
  },
  {
    "id": "preferences",
    "title": "设置与快捷键",
    "order": 5
  },
  {
    "id": "data",
    "title": "存储与备份",
    "order": 6
  },
  {
    "id": "sync",
    "title": "同步与设备",
    "order": 7
  },
  {
    "id": "integrations",
    "title": "外部 AI 与自动化",
    "order": 8
  },
  {
    "id": "security",
    "title": "隐私与权限",
    "order": 9
  },
  {
    "id": "troubleshooting",
    "title": "解决问题",
    "order": 10
  },
  {
    "id": "reference",
    "title": "术语与限制",
    "order": 11
  }
] as const satisfies readonly HelpTopic[];
export const manualArticles = [
  { ...{"id":"getting-started.basics","topicId":"getting-started","title":"第一次使用：读完并留下第一条研究笔记","summary":"用一篇本地 PDF 完成导入、阅读、批注和 AI 提问；不要求先开通全部服务。","keywords":["入门","新手","开始","导入","第一篇","quickstart"],"condition":"桌面版；具体能力以所用安装版本为准。","order":0,"related":["reading.import","agent.chat","data.locations"],"sourceIds":["S07","S08","S09","S10","S19"],"kind":"tutorial"}, body: body0 },
  { ...{"id":"getting-started.install","topicId":"getting-started","title":"安装、升级与确认自己的版本","summary":"区分安装包、源码和浏览器预览；升级前保存资料，升级后做最小验证。","keywords":["安装","升级","更新","Windows","exe","installer","版本"],"condition":"桌面版；具体能力以所用安装版本为准。","order":1,"related":["getting-started.modes","data.backup","troubleshooting.report"],"sourceIds":["S08","S22","S23","S15"],"kind":"how-to"}, body: body1 },
  { ...{"id":"getting-started.modes","topicId":"getting-started","title":"先选使用方式：本地、自己的 AI，还是云服务","summary":"把账号、网络、模型和文件权限分开理解，避免为了阅读而先配置所有服务。","keywords":["离线","无需登录","免费","账号","自备密钥","本地模式","云端","BYOK"],"condition":"桌面版；具体能力以所用安装版本为准。","order":2,"related":["agent.chat","discovery.recommendations","security.data"],"sourceIds":["S08","S10","S13","S16","S17"],"kind":"explanation"}, body: body2 },
  { ...{"id":"getting-started.workspace","topicId":"getting-started","title":"认识工作区、标签页与沉浸阅读","summary":"分清选择、打开和专注模式；找回被关闭的工具，不丢失当前任务。","keywords":["界面","布局","窗口","单击","双击","三击","沉浸","全屏","F11"],"condition":"桌面版；具体能力以所用安装版本为准。","order":3,"related":["preferences.shortcuts","reading.notes","boards.basics"],"sourceIds":["S07","S06","S10"],"kind":"how-to"}, body: body3 },
  { ...{"id":"reading.import","topicId":"reading","title":"导入文件并找到它","summary":"从本地文件开始，确认条目、正文与保存位置，而不只看导入提示。","keywords":["导入","拖入","PDF","文件夹","找不到文件","重复","import"],"condition":"桌面版；具体能力以所用安装版本为准。","order":4,"related":["reading.organize","reading.ebooks","troubleshooting.reading"],"sourceIds":["S07","S11","S12","S14"],"kind":"how-to"}, body: body4 },
  { ...{"id":"reading.organize","topicId":"reading","title":"用目录、分类、标签和图标整理文献","summary":"按位置整理、按主题检索；理解显示题名与物理文件名的区别。","keywords":["文件夹","目录","移动","重命名","分类","标签","图标","Emoji"],"condition":"桌面版；具体能力以所用安装版本为准。","order":5,"related":["reading.metadata","reading.import","data.locations"],"sourceIds":["S07","S12","S13"],"kind":"how-to"}, body: body5 },
  { ...{"id":"reading.metadata","topicId":"reading","title":"核对和修正论文元信息","summary":"让题名、作者、年份和标识对应同一篇论文；候选相似不等于已确认。","keywords":["题录","元数据","元信息","DOI","arXiv","Crossref","作者","年份","标题不对"],"condition":"桌面版；具体能力以所用安装版本为准。","order":6,"related":["discovery.recommendations","discovery.download","troubleshooting.models"],"sourceIds":["S13","S09","S15"],"kind":"how-to"}, body: body6 },
  { ...{"id":"reading.pdf","topicId":"reading","title":"阅读 PDF 与切换阅读模式","summary":"保持原文、阅读视图和批注之间的对应，理解页面未解析的情况。","keywords":["PDF","阅读模式","页码","缩放","文字层","解析","原文"],"condition":"桌面版；具体能力以所用安装版本为准。","order":7,"related":["reading.selection","reading.translate","troubleshooting.reading"],"sourceIds":["S07","S10","S11"],"kind":"how-to"}, body: body7 },
  { ...{"id":"reading.selection","topicId":"reading","title":"选段、批注、速问与引用","summary":"把一段原文变成可追溯的疑问或笔记，而不是失去出处的一段文字。","keywords":["选段","选择文字","高亮","下划线","批注","评论","速问","划线"],"condition":"桌面版；具体能力以所用安装版本为准。","order":8,"related":["agent.context","boards.research","reading.chatgpt-review"],"sourceIds":["S10","S11","S18"],"kind":"how-to"}, body: body8 },
  { ...{"id":"reading.translate","topicId":"reading","title":"查词、选段翻译与扫描件准备","summary":"把词典、翻译、论文解析和模型问答分开配置。","keywords":["查词","翻译","OCR","扫描件","词典","MinerU","识别"],"condition":"桌面版；具体能力以所用安装版本为准。","order":9,"related":["reading.pdf","agent.quality","troubleshooting.models"],"sourceIds":["S09","S10","S11","S08"],"kind":"how-to"}, body: body9 },
  { ...{"id":"reading.ebooks","topicId":"reading","title":"阅读电子书、Markdown、文本和 HTML","summary":"确认支持的具体格式，避免把文件扩展名当成兼容性保证。","keywords":["EPUB","MOBI","AZW","AZW3","FB2","HTML","Markdown","TXT","DRM","电子书"],"condition":"桌面版；具体能力以所用安装版本为准。","order":10,"related":["reading.import","reading.vault","preferences.appearance"],"sourceIds":["S11","S09"],"kind":"how-to"}, body: body10 },
  { ...{"id":"reading.notes","topicId":"reading","title":"创建论文笔记并保护未保存内容","summary":"在论文下保留自己的理解；保存前后都能确认版本和归属。","keywords":["笔记","Markdown","保存","草稿","论文附件","版本冲突","未保存"],"condition":"桌面版；具体能力以所用安装版本为准。","order":11,"related":["reading.vault","integrations.local-mcp","data.backup"],"sourceIds":["S10","S11","S17"],"kind":"how-to"}, body: body11 },
  { ...{"id":"reading.vault","topicId":"reading","title":"连接 Obsidian Vault 与外部 Markdown 文件夹","summary":"在授权范围内读取和编辑真实文件，处理外部修改而不覆盖草稿。","keywords":["Obsidian","Vault","Notes","外部目录","连接文件夹","文件被修改","markdown"],"condition":"桌面版；具体能力以所用安装版本为准。","order":12,"related":["reading.notes","sync.webdav","sync.conflicts"],"sourceIds":["S11","S10","S16","S17"],"kind":"how-to"}, body: body12 },
  { ...{"id":"boards.basics","topicId":"boards","title":"创建并操作研究白板","summary":"掌握卡片、连线、选择与视图操作，建立自己的研究结构。","keywords":["白板","Canvas","卡片","连线","框选","缩放","画布"],"condition":"桌面版；具体能力以所用安装版本为准。","order":13,"related":["boards.research","reading.selection","reading.notes"],"sourceIds":["S10","S17"],"kind":"how-to"}, body: body13 },
  { ...{"id":"boards.research","topicId":"boards","title":"用白板组织一组论文证据","summary":"将原文、自己的推断和待验证问题分区，形成可复用的研究图。","keywords":["研究白板","多论文","证据","综述","关系","引用"],"condition":"桌面版；具体能力以所用安装版本为准。","order":14,"related":["agent.context","agent.artifacts","agent.quality"],"sourceIds":["S10","S17","S19"],"kind":"tutorial"}, body: body14 },
  { ...{"id":"agent.chat","topicId":"agent","title":"连接模型并开始 AI 对话","summary":"测试模型、核对资源，再发出可回答的问题。","keywords":["AI","模型","API key","聊天","DeepSeek","Ollama","连接","密钥"],"condition":"桌面版；具体能力以所用安装版本为准。","order":15,"related":["agent.context","troubleshooting.models","security.data"],"sourceIds":["S08","S09","S07"],"kind":"how-to"}, body: body15 },
  { ...{"id":"agent.context","topicId":"agent","title":"准确提供上下文：@、拖入、选段与 / 能力","summary":"让助手知道要读什么、做到什么程度，以及哪些内容不能改。","keywords":["上下文","引用","@","斜杠","技能","拖拽","没有读全文","context"],"condition":"桌面版；具体能力以所用安装版本为准。","order":16,"related":["agent.quality","integrations.local-mcp","boards.research"],"sourceIds":["S07","S10","S17","S19"],"kind":"how-to"}, body: body16 },
  { ...{"id":"agent.thin-reading","topicId":"agent","title":"用 AI 薄读建立论文的第一张地图","summary":"先确认论文，再生成概览；把薄读当成定位重点的入口，而非全文核验的替代。","keywords":["薄读","thin reading","概览","总结","论文分析","读不懂"],"condition":"桌面版；具体能力以所用安装版本为准。","order":17,"related":["agent.artifacts","agent.prompts","agent.quality"],"sourceIds":["S19","S07","S09","S08"],"kind":"how-to"}, body: body17 },
  { ...{"id":"agent.artifacts","topicId":"agent","title":"生成提纲、PPT、思维导图和对比表","summary":"按同一套“选择论文—确认—选能力—生成”流程产出研究材料。","keywords":["提纲","PPT","幻灯片","思维导图","对比表","生成","产物"],"condition":"桌面版；具体能力以所用安装版本为准。","order":18,"related":["agent.prompts","agent.quality","troubleshooting.models"],"sourceIds":["S19","S08","S10"],"kind":"how-to"}, body: body18 },
  { ...{"id":"agent.prompts","topicId":"agent","title":"调整默认提示词与单次生成风格","summary":"把长期偏好和当前任务要求分开，保持结果可复现。","keywords":["提示词","prompt","系统提示词","风格","语言","默认","生成偏好"],"condition":"桌面版；具体能力以所用安装版本为准。","order":19,"related":["agent.thin-reading","agent.artifacts","agent.quality"],"sourceIds":["S09","S19"],"kind":"how-to"}, body: body19 },
  { ...{"id":"agent.quality","topicId":"agent","title":"怎样判断 AI 结果可以使用","summary":"核对来源、覆盖、数值和不确定性；不要把生成成功当成事实正确。","keywords":["幻觉","错误","引用","可信","核验","证据","结果质量","全文"],"condition":"桌面版；具体能力以所用安装版本为准。","order":20,"related":["agent.context","reading.metadata","troubleshooting.report"],"sourceIds":["S08","S15","S17","S19"],"kind":"explanation"}, body: body20 },
  { ...{"id":"agent.extensions","topicId":"agent","title":"使用技能、插件和工作流前，先确认能力边界","summary":"从当前 / 能力列表和扩展设置出发，不把设计文档当成已安装功能。","keywords":["Skill","技能","插件","工作流","扩展","slash","自动化"],"condition":"桌面版；具体能力以所用安装版本为准。","order":21,"related":["integrations.local-mcp","agent.prompts","security.permissions"],"sourceIds":["S07","S09","S17","S23"],"kind":"explanation"}, body: body21 },
  { ...{"id":"discovery.recommendations","topicId":"discovery","title":"发现相关论文并理解推荐理由","summary":"选对文献服务、查看详情，再决定收藏或获取全文。","keywords":["推荐","关联推荐","文献服务","发现","Crossref","OpenAlex","Semantic Scholar"],"condition":"桌面版；具体能力以所用安装版本为准。","order":22,"related":["discovery.personalization","discovery.download","reading.metadata"],"sourceIds":["S13","S15","S09"],"kind":"how-to"}, body: body22 },
  { ...{"id":"discovery.personalization","topicId":"discovery","title":"按需启用增强推荐，控制资料外发","summary":"理解默认关闭、本地回退、独立向量接口与隐私开关。","keywords":["增强推荐","向量","embedding","reranker","重排","画像","隐私","外发"],"condition":"0.1.28 源码中的可选功能；默认关闭；生产质量与 Windows 实机验收未由本包确认。","order":23,"related":["security.data","discovery.profile","troubleshooting.models"],"sourceIds":["S15","S09"],"kind":"how-to"}, body: body23 },
  { ...{"id":"discovery.download","topicId":"discovery","title":"获取论文全文并确认实际下载结果","summary":"从题录解析可访问的 PDF；处理受限、重复、取消和错误版本。","keywords":["下载","全文","PDF 下载","付费墙","开放获取","arxiv","重复","download"],"condition":"桌面版；具体能力以所用安装版本为准。","order":24,"related":["integrations.batch-import","reading.metadata","troubleshooting.reading"],"sourceIds":["S14","S15","S17"],"kind":"how-to"}, body: body24 },
  { ...{"id":"discovery.profile","topicId":"discovery","title":"管理本地阅读画像和推荐输入","summary":"区分记录行为、使用已确认画像、外发资料与同步画像。","keywords":["画像","记忆","阅读行为","偏好","本地记录","清空画像","隐私设置"],"condition":"桌面版；具体能力以所用安装版本为准。","order":25,"related":["discovery.personalization","sync.webdav","security.permissions"],"sourceIds":["S10","S15","S16","S09"],"kind":"how-to"}, body: body25 },
  { ...{"id":"preferences.appearance","topicId":"preferences","title":"调整外观、字体和阅读舒适度","summary":"分别配置界面与阅读字体，用可读性而不是一次展开所有功能作为目标。","keywords":["主题","深色","浅色","字体","字号","缩放","护眼","界面大小"],"condition":"桌面版；具体能力以所用安装版本为准。","order":26,"related":["getting-started.workspace","preferences.settings-map","reading.translate"],"sourceIds":["S09","S10","S11"],"kind":"how-to"}, body: body26 },
  { ...{"id":"preferences.shortcuts","topicId":"preferences","title":"快捷键与按键作用范围","summary":"全局快捷键从应用注册表生成；阅读器和白板按焦点使用。","keywords":["快捷键","F1","F11","Ctrl","Command","键盘","命令面板"],"condition":"桌面版；具体能力以所用安装版本为准。","order":27,"related":["getting-started.workspace","boards.basics","preferences.settings-map"],"sourceIds":["S06","S07","S10","S24"],"kind":"reference"}, body: body27 },
  { ...{"id":"preferences.settings-map","topicId":"preferences","title":"设置导航速查","summary":"按当前界面名称找到设置，不依赖旧文档中的路径。","keywords":["设置","在哪里","入口","设置搜索","导航","settings"],"condition":"桌面版；具体能力以所用安装版本为准。","order":28,"related":["agent.chat","data.locations","sync.webdav"],"sourceIds":["S09","S20"],"kind":"reference"}, body: body28 },
  { ...{"id":"data.locations","topicId":"data","title":"查看和迁移数据保存位置","summary":"在应用内完成复制、校验与切换，不手动搬动正在使用的数据。","keywords":["数据目录","LiteasyData","保存位置","迁移","换盘","安装目录"],"condition":"桌面版；具体能力以所用安装版本为准。","order":29,"related":["data.backup","sync.webdav","troubleshooting.sync"],"sourceIds":["S20","S09","S16"],"kind":"how-to"}, body: body29 },
  { ...{"id":"data.backup","topicId":"data","title":"备份、恢复与删除前检查","summary":"把同步副本、缓存和独立备份分开；先验证恢复，再处理原件。","keywords":["备份","恢复","删除","回滚","换电脑","丢失","backup"],"condition":"桌面版；具体能力以所用安装版本为准。","order":30,"related":["data.locations","sync.conflicts","troubleshooting.report"],"sourceIds":["S09","S20","S16","S13","S11"],"kind":"how-to"}, body: body30 },
  { ...{"id":"sync.webdav","topicId":"sync","title":"配置 WebDAV 并选择同步范围","summary":"在自己的服务上同步选定数据，先用小库验证，再扩展范围。","keywords":["WebDAV","坚果云","同步","服务器","类别","云盘"],"condition":"桌面版；具体能力以所用安装版本为准。","order":31,"related":["sync.conflicts","sync.secrets","data.backup"],"sourceIds":["S16","S13","S09"],"kind":"how-to"}, body: body31 },
  { ...{"id":"sync.conflicts","topicId":"sync","title":"处理同步冲突、延迟应用与多设备修改","summary":"保全两边内容，理解整组冲突与重启恢复，不盲目选择覆盖。","keywords":["冲突","同步失败","延迟应用","重启","覆盖","恢复副本","ETag"],"condition":"桌面版；具体能力以所用安装版本为准。","order":32,"related":["sync.webdav","data.backup","troubleshooting.sync"],"sourceIds":["S16","S13"],"kind":"how-to"}, body: body32 },
  { ...{"id":"sync.secrets","topicId":"sync","title":"单独决定是否同步 API key","summary":"默认不传密钥；开启前理解口令、范围和无法撤回的边界。","keywords":["API key 同步","同步口令","加密","密钥","密码","凭据"],"condition":"桌面版；具体能力以所用安装版本为准。","order":33,"related":["security.data","security.permissions","sync.webdav"],"sourceIds":["S16","S08"],"kind":"how-to"}, body: body33 },
  { ...{"id":"sync.cloud","topicId":"sync","title":"账号、云端元数据与共享批注","summary":"区分个人本地资料、云端服务和主动共享，不把登录视为所有功能开通。","keywords":["账号","登录","注册","云同步","元数据同步","共享批注","Intuecho"],"condition":"需所用安装的账号与云端／共享服务已配置；本包不确认生产部署可用。","order":34,"related":["getting-started.modes","reading.chatgpt-review","integrations.mobile"],"sourceIds":["S08","S09","S22","S18"],"kind":"how-to"}, body: body34 },
  { ...{"id":"integrations.local-mcp","topicId":"integrations","title":"把本机研究资产连接到 Codex 等 MCP 客户端","summary":"从只读开始，使用应用生成的真实配置，再按需允许写入。","keywords":["MCP","Codex","STDIO","本机","外部 AI","配置","连接文件"],"condition":"桌面本机功能；默认关闭；客户端需支持 STDIO；真实 Windows 联调待使用者验证。","order":35,"related":["integrations.batch-import","reading.notes","security.permissions"],"sourceIds":["S17","S09","R08"],"kind":"how-to"}, body: body35 },
  { ...{"id":"integrations.batch-import","topicId":"integrations","title":"通过 MCP 批量导入论文并追踪逐项结果","summary":"使用稳定标识、任务 ID 和幂等重试，不把请求受理当成全部下载成功。","keywords":["批量导入","MCP 导入","任务状态","operationId","jobId","DOI","arxiv"],"condition":"需本机 MCP 与写入授权；需互联网全文来源；每批最多 50 篇。","order":36,"related":["discovery.download","integrations.local-mcp","troubleshooting.report"],"sourceIds":["S17","S14","S15"],"kind":"how-to"}, body: body36 },
  { ...{"id":"integrations.mobile","topicId":"sync","title":"从手机向桌面发送受控任务","summary":"先确认同账号、同服务和配对条件；手机不是任意远程控制终端。","keywords":["手机","Android","设备","配对","八位码","远程任务","唤醒"],"condition":"需同账户同服务、原生 OAuth、已部署设备控制；真实端到端验收未由本包确认。","order":37,"related":["sync.webdav","agent.chat","security.permissions"],"sourceIds":["S21","S09"],"kind":"how-to"}, body: body37 },
  { ...{"id":"reading.chatgpt-review","topicId":"reading","title":"连接 ChatGPT Review 论文评论","summary":"只共享当前论文的个人文字评论，用快照和撤销控制读取范围。","keywords":["ChatGPT","评论","Review","隧道","共享","CONTROL_PLANE_API_KEY"],"condition":"仅 Linux/macOS 桌面评论连接；需 Node.js、源码服务和 ChatGPT 账户权限；只读快照。","order":38,"related":["integrations.local-mcp","reading.selection","security.permissions"],"sourceIds":["S18","R09","R10"],"kind":"how-to"}, body: body38 },
  { ...{"id":"security.data","topicId":"security","title":"资料会被发送到哪里","summary":"按功能判断数据流向，不把“本地优先”理解成所有功能均不联网。","keywords":["隐私","安全","数据流","上传","外发","联网","密钥","本地优先"],"condition":"桌面版；具体能力以所用安装版本为准。","order":39,"related":["security.permissions","sync.secrets","discovery.personalization"],"sourceIds":["S08","S10","S15","S16","S17","S18","S21"],"kind":"explanation"}, body: body39 },
  { ...{"id":"security.permissions","topicId":"security","title":"授权、撤销与不可逆操作清单","summary":"在共享、写入、同步和取消前确认真正的效果与剩余副本。","keywords":["撤销","停止共享","关闭权限","取消任务","删除远端","权限","令牌"],"condition":"桌面版；具体能力以所用安装版本为准。","order":40,"related":["integrations.local-mcp","sync.conflicts","troubleshooting.report"],"sourceIds":["S16","S17","S18","S21","S20"],"kind":"reference"}, body: body40 },
  { ...{"id":"troubleshooting.start","topicId":"troubleshooting","title":"遇到问题，先定位哪条链路失败","summary":"用最小样本区分本地文件、解析、模型、文献服务和同步问题。","keywords":["故障","错误","不能用","卡住","打不开","排错","troubleshooting"],"condition":"桌面版；具体能力以所用安装版本为准。","order":41,"related":["troubleshooting.models","troubleshooting.reading","troubleshooting.sync","troubleshooting.report"],"sourceIds":["S08","S13","S15","S16","S20"],"kind":"how-to"}, body: body41 },
  { ...{"id":"troubleshooting.models","topicId":"troubleshooting","title":"模型、推荐和解析服务连不上","summary":"先确认失败的服务，再检查地址、权限、配额和输出协议。","keywords":["401","403","429","CORS","超时","连接失败","response_format","JSON","模型失败"],"condition":"桌面版；具体能力以所用安装版本为准。","order":42,"related":["agent.chat","discovery.personalization","troubleshooting.report"],"sourceIds":["S08","S09","S13","S15"],"kind":"how-to"}, body: body42 },
  { ...{"id":"troubleshooting.reading","topicId":"troubleshooting","title":"PDF、电子书、笔记和 Vault 排错","summary":"分别处理格式、文字层、目录、内存与外部编辑问题。","keywords":["空白","扫描件","内存不足","Out of Memory","乱码","缺图","保存失败","文件丢失"],"condition":"桌面版；具体能力以所用安装版本为准。","order":43,"related":["reading.pdf","reading.vault","troubleshooting.report"],"sourceIds":["S11","S10","S12","S13","S14","S15"],"kind":"how-to"}, body: body43 },
  { ...{"id":"troubleshooting.sync","topicId":"troubleshooting","title":"同步、迁移和恢复失败时怎么做","summary":"保留恢复材料，分清连接、范围、版本与应用时机。","keywords":["同步失败","坚果云错误","迁移失败","备份失败","重启恢复","大文件"],"condition":"桌面版；具体能力以所用安装版本为准。","order":44,"related":["sync.conflicts","data.locations","data.backup","troubleshooting.report"],"sourceIds":["S16","S13","S20"],"kind":"how-to"}, body: body44 },
  { ...{"id":"troubleshooting.report","topicId":"troubleshooting","title":"提交有用且不泄密的问题报告","summary":"给维护者可复现信息，而不是一张混有凭据的长截图。","keywords":["反馈","bug","问题报告","日志","截图","维护者","报错"],"condition":"桌面版；具体能力以所用安装版本为准。","order":45,"related":["troubleshooting.start","security.data","reference.limits"],"sourceIds":["S08","S11","S15","S16","S22"],"kind":"how-to"}, body: body45 },
  { ...{"id":"reference.glossary","topicId":"reference","title":"术语表：先理解用户看到的对象","summary":"用界面任务理解元数据、产物、画像、快照、MCP 和版本。","keywords":["术语","概念","名词","metadata","artifact","revision","MCP","WebDAV"],"condition":"桌面版；具体能力以所用安装版本为准。","order":46,"related":["getting-started.modes","agent.context","sync.conflicts"],"sourceIds":["S02","S08","S13","S16","S17","S18","S19"],"kind":"reference"}, body: body46 },
  { ...{"id":"reference.limits","topicId":"reference","title":"平台、服务和限制总览","summary":"集中查看本次代码基线的边界；区分实现、默认开关和实机验收。","keywords":["限制","平台","Windows","浏览器","版本","兼容","上限","未支持"],"condition":"桌面版；具体能力以所用安装版本为准。","order":47,"related":["troubleshooting.report","security.data","getting-started.install"],"sourceIds":["S08","S11","S15","S16","S17","S18","S21"],"kind":"reference"}, body: body47 },
  { ...{"id":"reading.references","topicId":"reading","title":"文件链接与片段引用","summary":"双括号补全、内容选择、标题与行范围、悬浮预览和嵌入。","keywords":["双括号","链接","引用","嵌入","片段","行号","标题","上下文"],"condition":"支持 Markdown 编辑的 Liteasy 页面；需要已可访问的目标资产。","order":119,"related":["reading.notes","reading.vault","agent.context"],"sourceIds":["local-resource-links"],"kind":"task"}, body: body48 },
] as const satisfies readonly ManualRecord[];

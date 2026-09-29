import { settingsRegistry } from "./settingsRegistry";
import type { SettingKey } from "./settings.types";

export const settingsCategories = [
  { id: "all", label: "全部设置" },
  { id: "appearance", label: "外观与阅读" },
  { id: "ai", label: "AI 与助手" },
  { id: "papers", label: "论文与推荐" },
  { id: "storage", label: "文件与存储" },
  { id: "sync", label: "同步与备份" }
] as const;

export type SettingsCategory = typeof settingsCategories[number]["id"];
type SettingsSection = {
  id: string;
  category: Exclude<SettingsCategory, "all">;
  title: string;
  description: string;
  keywords: string;
  keys: readonly SettingKey[];
};

export const settingsSections = [
  { id: "appearance", category: "appearance", title: "外观与阅读", description: "调整主题、界面大小、阅读字体和 PDF 阅读底色。", keywords: "light dark theme 字体 字号 护眼 缩放 浅色 深色 暖黄 电子书 EPUB MOBI Markdown TXT",
    keys: ["view.theme", "view.font_family", "view.reader_font_family", "view.font_size", "view.display_scale", "view.pdf_background", "view.pdf_custom_background"] },
  { id: "models", category: "ai", title: "模型与连接", description: "连接自己的 API，验证模型后可在对话中切换。", keywords: "服务商 供应商 provider API key 密钥 OpenAI Claude Anthropic DeepSeek Ollama Gemini 云代理 AI 接入 协议 结构化输出 已验证模型",
    keys: ["models.connection_mode", "models.direct_provider", "models.direct_endpoint", "models.direct_model", "models.direct_protocol", "models.direct_output_format"] },
  { id: "assistant", category: "ai", title: "助手偏好", description: "设置生成语言、过程展示，查看助手扩展能力。", keywords: "Agent 技能 Skill Plugin MCP 插件 工具 扩展 安全 中文 English",
    keys: ["assistant.context_window", "assistant.language", "assistant.public_audit.enabled"] },
  { id: "local-mcp", category: "ai", title: "本机 MCP · Codex", description: "将 Liteasy 研究资产接入自己的 AI 工作流。", keywords: "Windows MCP Codex 本机 连接 读写 笔记 白板 资产 STDIO", keys: [] },
  { id: "papers", category: "papers", title: "论文解析与薄读", description: "选择薄读方式、元信息来源和扫描件识别语言。", keywords: "OCR 识别 扫描 PDF 元数据 DOI Crossref OpenAlex Semantic Scholar MinerU 提取 快速 严谨",
    keys: ["thin_reading.mode", "papers.metadata_provider", "papers.metadata_endpoint", "papers.mineru_mode", "papers.mineru_endpoint", "import.ocr_language"] },
  { id: "recommendations", category: "papers", title: "论文推荐", description: "按研究习惯发现前沿进展、经典文献和相邻领域。", keywords: "联网推荐 风格 前沿 经典 均衡 跨域 探索 离线 本地 自备 API 画像",
    keys: ["papers.local_mode", "profile.local_enabled", "network.recommendation.enabled", "network.recommendation.style"] },
  { id: "data", category: "storage", title: "数据保存位置", description: "查看和迁移 Liteasy 的本地数据目录。", keywords: "路径 文件夹 安装目录 LiteasyData 重启 聊天 笔记 生成内容", keys: [] },
  { id: "library", category: "storage", title: "文献库与备份", description: "管理文献库目录、导入旧库或创建本地备份。", keywords: "路径 保存位置 文件夹 迁移 备份 backup library 本地", keys: [] },
  { id: "webdav", category: "sync", title: "WebDAV 同步", description: "选择同步文献、笔记、白板、画像、外部目录与密钥。", keywords: "WebDAV 服务器 账号 密码 自动同步 备份 冲突 笔记 白板 画像 API key 外部目录", keys: [] },
  { id: "metadata", category: "sync", title: "文献元数据同步", description: "查看文献元信息的云端同步状态。", keywords: "云端 账号 元信息 重试 同步", keys: [] },
  { id: "annotations", category: "sync", title: "共享批注", description: "设置公开批注的同步服务。", keywords: "Intuecho 高亮 批注 同步 端点 HTTPS",
    keys: ["thin_reading.intuecho_endpoint"] }
] as const satisfies readonly SettingsSection[];

export type SettingsSectionId = typeof settingsSections[number]["id"];

export function matchesSettingsSearch(section: SettingsSection, query: string) {
  const category = settingsCategories.find((item) => item.id === section.category)?.label;
  const text = [section.title, section.description, section.keywords, category,
    ...section.keys.flatMap((key) => [settingsRegistry[key].label, settingsRegistry[key].help ?? ""])
  ].join(" ").toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every((term) => text.includes(term));
}

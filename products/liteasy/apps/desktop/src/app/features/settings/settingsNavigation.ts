import { message } from "../../shared/i18n/i18n";
import { generationPromptKey, generationPromptTasks, type GenerationPromptTask } from "../ai-prompts/generationPrompts";
import { settingsRegistry } from "./settingsRegistry";
import type { SettingKey } from "./settings.types";

export const settingsCategories = [
  { id: "all", get label() { return message("settings.category.all"); } },
  { id: "appearance", get label() { return message("settings.category.appearance"); } },
  { id: "ai", get label() { return message("settings.category.ai"); } },
  { id: "papers", get label() { return message("settings.category.papers"); } },
  { id: "storage", get label() { return message("settings.category.storage"); } },
  { id: "sync", get label() { return message("settings.category.sync"); } },
  { id: "extensions", get label() { return message("settings.category.extensions"); } }
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
  { id: "appearance", category: "appearance", get title() { return message("settings.category.appearance"); }, get description() { return message("settings.section.appearance.description"); }, keywords: "language locale system 跟随系统 简体中文 English 界面语言 light dark theme 中文 英文 字体 字号 护眼 缩放 浅色 深色 暖黄 电子书 EPUB MOBI Markdown TXT",
    keys: ["view.language", "view.list_density", "view.markdown_mode", "view.markdown_autosave", "view.close_empty_panels", "view.theme", "view.font_family", "view.reader_font_family", "view.font_family_zh", "view.font_family_en", "view.reader_font_family_zh", "view.reader_font_family_en", "view.font_size", "view.display_scale", "view.pdf_background", "view.pdf_preserve_images", "view.pdf_custom_background"] },
  { id: "selection-lookup", category: "appearance", get title() { return message("settings.section.selectionLookup.title"); }, get description() { return message("settings.section.selectionLookup.description"); }, keywords: "dictionary translate 查词 单词 短语 翻译 释义 音标 发音 必应 有道 英英 LibreTranslate 自部署",
    keys: ["lookup.dictionary_service", "lookup.translation_service", "lookup.source_language", "lookup.target_language", "lookup.auto_query", "lookup.libretranslate_endpoint"] },
  { id: "models", category: "ai", get title() { return message("settings.section.models.title"); }, get description() { return message("settings.section.models.description"); }, keywords: "服务商 供应商 provider API key 密钥 OpenAI Claude Anthropic DeepSeek Ollama Gemini 云代理 AI 接入 协议 结构化输出 已验证模型",
    keys: ["models.connection_mode", "models.direct_provider", "models.direct_endpoint", "models.direct_model", "models.direct_protocol", "models.direct_output_format"] },
  { id: "assistant", category: "ai", get title() { return message("settings.section.assistant.title"); }, get description() { return message("settings.section.assistant.description"); }, keywords: "Agent 技能 Skill Plugin MCP 插件 工具 扩展 安全 中文 English",
    keys: ["assistant.context_window", "assistant.language", "assistant.public_audit.enabled"] },
  { id: "generation-prompts", category: "ai", get title() { return message("settings.section.prompts.title"); }, get description() { return message("settings.section.prompts.description"); }, keywords: "系统提示词 prompt 讲解 速问 标注 薄读 提纲 PPT 思维导图 对比表 深入 精简 点拨 提问 详细 直觉",
    keys: Object.keys(generationPromptTasks).map((task) => generationPromptKey(task as GenerationPromptTask)) },
  { id: "local-mcp", category: "ai", get title() { return message("settings.section.localMcp.title"); }, get description() { return message("settings.section.localMcp.description"); }, keywords: "Windows MCP Codex 本机 连接 读写 笔记 白板 资产 STDIO", keys: [] },
  { id: "papers", category: "papers", get title() { return message("settings.section.papers.title"); }, get description() { return message("settings.section.papers.description"); }, keywords: "OCR 识别 扫描 PDF 元数据 DOI Crossref OpenAlex Semantic Scholar MinerU 提取 快速 严谨",
    keys: ["thin_reading.mode", "papers.metadata_provider", "papers.metadata_endpoint", "papers.mineru_mode", "papers.mineru_endpoint", "import.ocr_language"] },
  { id: "recommendations", category: "papers", get title() { return message("settings.section.recommendations.title"); }, get description() { return message("settings.section.recommendations.description"); }, keywords: "联网推荐 风格 前沿 经典 均衡 跨域 探索 离线 本地 自备 API 画像 批注 向量 embedding reranker 重排 隐私 索引",
    keys: ["papers.local_mode", "profile.local_enabled", "network.recommendation.enabled", "network.recommendation.style"] },
  { id: "data", category: "storage", get title() { return message("settings.section.data.title"); }, get description() { return message("settings.section.data.description"); }, keywords: "路径 文件夹 安装目录 LiteasyData 重启 聊天 笔记 生成内容", keys: [] },
  { id: "local-files", category: "storage", get title() { return message("settings.section.localFiles.title"); }, get description() { return message("settings.section.localFiles.description"); }, keywords: "文件 批量 复制 copy 预览 取消 重试 撤销 receipts", keys: [] },
  { id: "local-recovery", category: "storage", get title() { return message("settings.section.recovery.title"); }, get description() { return message("settings.section.recovery.description"); }, keywords: "完整 备份 快照 backup profile recovery 恢复 本地 隔离", keys: [] },
  { id: "local-archive", category: "storage", get title() { return message("settings.section.archive.title"); }, get description() { return message("settings.section.archive.description"); }, keywords: "归档 archive 导出 export 恢复 restore 笔记 批注 备份", keys: [] },
  { id: "library", category: "storage", get title() { return message("settings.section.library.title"); }, get description() { return message("settings.section.library.description"); }, keywords: "路径 保存位置 文件夹 迁移 备份 backup library 本地", keys: [] },
  { id: "webdav", category: "sync", get title() { return message("settings.section.webdav.title"); }, get description() { return message("settings.section.webdav.description"); }, keywords: "WebDAV 服务器 账号 密码 自动同步 备份 冲突 笔记 白板 画像 API key 外部目录", keys: [] },
  { id: "devices", category: "sync", get title() { return message("settings.section.devices.title"); }, get description() { return message("settings.section.devices.description"); }, keywords: "Android 手机 移动 设备 配对码 远程 打开 摘要 提取 任务", keys: [] },
  { id: "metadata", category: "sync", get title() { return message("settings.section.metadata.title"); }, get description() { return message("settings.section.metadata.description"); }, keywords: "云端 账号 元信息 重试 同步", keys: [] },
  { id: "annotations", category: "sync", get title() { return message("settings.section.annotations.title"); }, get description() { return message("settings.section.annotations.description"); }, keywords: "Intuecho 高亮 批注 同步 端点 HTTPS",
    keys: ["thin_reading.intuecho_endpoint"] }
] as const satisfies readonly SettingsSection[];

export type SettingsSectionId = typeof settingsSections[number]["id"];

export function matchesSettingsSearch(section: SettingsSection, query: string) {
  const category = settingsCategories.find((item) => item.id === section.category)?.label;
  const text = [section.id, ...section.keys, section.title, section.description, section.keywords, category,
    ...section.keys.flatMap((key) => [settingsRegistry[key].label, settingsRegistry[key].help ?? ""])
  ].join(" ").toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every((term) => text.includes(term));
}

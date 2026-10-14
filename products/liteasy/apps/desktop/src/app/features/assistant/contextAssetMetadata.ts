import type { AssistantComposerSuggestion } from "./assistant.types";

export const contextKindLabels: Record<string, string> = { paper: "论文", project: "项目", text: "原文", image: "图片", note: "笔记", annotation: "批注", excerpt: "摘录", board: "白板", artifact: "产物", document: "阅读文件", conversation: "对话", help: "帮助", setting: "设置", other: "其他资产" };
export const contextKind = (asset: AssistantComposerSuggestion) => asset.searchMetadata?.kind ?? Object.keys(contextKindLabels).find((key) => contextKindLabels[key] === asset.category) ?? "other";
export const contextDomain = (asset: AssistantComposerSuggestion) => asset.domain ?? (["help", "setting"].includes(contextKind(asset)) ? "application" : "research");

/** UI categories intentionally differ from persistence kinds. Projects are containers. */
export const contextUiKinds: Record<string, string> = {
  document: "文献与文件", text: "原文", image: "图片", note: "笔记", annotation: "批注",
  excerpt: "摘录", artifact: "AI 产物", board: "白板", conversation: "对话", other: "其他",
  setting: "设置", help: "帮助",
};
const kindAliases: Record<string, string> = { paper: "document", file: "document", page: "text", table: "other", formula: "other" };
export const normalizeUiKind = (kind: string) => kindAliases[kind] ?? (contextUiKinds[kind] ? kind : "all");
export const contextUiKind = (asset: AssistantComposerSuggestion) => normalizeUiKind(contextKind(asset));

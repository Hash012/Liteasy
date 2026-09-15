import type { AssistantComposerSuggestion } from "../assistant/assistant.types";
import type { ArtifactType } from "./artifact.types";

const artifactCommands = [
  { artifactType: "thin_reading", label: "生成薄读", detail: "分层讲解论文与关键证据" },
  { artifactType: "ppt", label: "制作PPT", detail: "演示文稿、幻灯片与汇报大纲" },
  { artifactType: "tree", label: "制作提纲", detail: "按主题整理层级学习大纲" },
  { artifactType: "mindmap", label: "生成思维导图", detail: "梳理概念、方法与证据关系" },
  { artifactType: "comparison_table", label: "生成对比表", detail: "比较多篇论文的方法与结论" },
  { artifactType: "layered_graph", label: "生成分层关系图", detail: "展开论文之间的概念关系" }
] as const;

export const artifactSlashSuggestions: AssistantComposerSuggestion[] = artifactCommands.map(({ label, detail }) => ({ id: `command-${label}`, label, detail, insertText: `/${label}`, trigger: "/" }));

/** All text shortcuts resolve a capability; execution belongs to the artifact workflow. */
export function requestedArtifactType(message: string): ArtifactType | null {
  const text = message.trim();
  const commandText = text.replace(/^\//, "");
  const selectedCommand = artifactCommands.find(({ label }) => commandText.startsWith(label) &&
    (commandText.length === label.length || /^[\s，,。:：]/.test(commandText.slice(label.length))));
  if (selectedCommand) return selectedCommand.artifactType;
  if (/^(?:请问|我想知道|你知道)?\s*(?:如何|怎么|怎样|how (?:do|can|to))|(?:PPT|幻灯片|演示文稿|大纲|提纲|slides?).{0,6}(?:是什么|怎么用|如何使用|的区别)/i.test(text)) return null;
  if (/^(?:请)?(?:不要|不用|别|do not|don't).{0,12}(?:生成|制作|做|画|create|generate)/i.test(text)) return null;
  if (/(?:不要|不用|别|do not|don't).{0,12}(?:薄读|thin[ _-]?reading|生成)/i.test(text) ||
    /(?:薄读|thin[ _-]?reading).{0,4}(?:是什么|什么意思|怎么用|如何使用|的区别)/i.test(text)) return null;
  if (/(?:这[个份篇]?|已有|所选|添加的|生成的|上面|刚才的)薄读|薄读(?:中|里|内)|薄读的(?!风格)/.test(text) &&
    !/(?:重新|继续)?生成|再做|制作|create|generate/i.test(text.replace(/生成的/g, ""))) return null;
  const thin = /薄读|thin[ _-]?read(?:ing)?/i.test(text);
  if (thin) return "thin_reading";
  if (!/(生成|做|制作|画|绘制|create|generate|draw)/i.test(text)) return null;
  if (/分层关系图|分层图|obsidian|星图|关系网络/i.test(text)) return "layered_graph";
  if (/思维导图|脑图|mind\s?map/i.test(text)) return "mindmap";
  if (/ppt|powerpoint|slides?|演示文稿|幻灯片/i.test(text)) return "ppt";
  if (/树状图|树形图|树形展开|提纲|大纲|outline/i.test(text)) return "tree";
  if (/对比表|对比矩阵|comparison table/i.test(text)) return "comparison_table";
  return null;
}

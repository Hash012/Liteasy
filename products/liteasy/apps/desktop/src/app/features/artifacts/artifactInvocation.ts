import type { ArtifactType } from "./artifact.types";

/** All text shortcuts resolve a capability; execution belongs to the artifact workflow. */
export function requestedArtifactType(message: string): ArtifactType | null {
  const text = message.trim();
  if (/(?:不要|不用|别|do not|don't).{0,12}(?:薄读|thin[ _-]?reading|生成)/i.test(text) ||
    /(?:薄读|thin[ _-]?reading).{0,4}(?:是什么|什么意思|怎么用|如何使用|的区别)/i.test(text)) return null;
  const thin = /薄读|thin[ _-]?read(?:ing)?/i.test(text);
  if (thin) return "thin_reading";
  if (!/(生成|做|制作|画|绘制|create|generate|draw)/i.test(text)) return null;
  if (/分层关系图|分层图|obsidian|星图|关系网络/i.test(text)) return "layered_graph";
  if (/思维导图|脑图|mind\s?map/i.test(text)) return "mindmap";
  if (/树状图|树形图|树形展开/i.test(text)) return "tree";
  if (/对比表|对比矩阵|comparison table/i.test(text)) return "comparison_table";
  if (/\bppt\b|演示文稿|幻灯片/i.test(text)) return "ppt";
  return null;
}

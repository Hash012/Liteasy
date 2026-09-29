import { Component, type CSSProperties, type ReactNode } from "react";
import type { BlockPresentation } from "../objects/visualBlock.types";
import { defaultReadingFontCss } from "../settings/readingFonts";
import { MarkdownContent } from "../markdown/MarkdownContent";
import "./visualBlocks.css";

class ContentBoundary extends Component<{ children: ReactNode; fallback: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div role="status"><p>内容显示遇到问题，仍可移动、复制或加入上下文。</p><pre>{this.props.fallback}</pre></div> : this.props.children;
  }
}

/** The host owns typography and failure handling; derived renderers only own content. */
export function VisualBlockBase({ presentation, identity, fallback, children }: {
  presentation?: BlockPresentation; identity: string; fallback: string; children: ReactNode;
}) {
  const style: CSSProperties = {
    fontFamily: presentation?.fontFamily || defaultReadingFontCss,
    fontSize: presentation?.fontSize ? `${presentation.fontSize}px` : "var(--block-font-size, 16px)",
    lineHeight: presentation?.lineHeight ?? 1.6,
    overflowWrap: presentation?.wrap === false ? "normal" : "anywhere",
    whiteSpace: presentation?.wrap === false ? "pre" : undefined,
  };
  return <div className="visual-block-base" style={style} data-resource-identity={identity}>
    <ContentBoundary key={identity} fallback={fallback}>{children}</ContentBoundary>
  </div>;
}

export function RichTextBlock({ text, onOpenPath }: { text: string; onOpenPath?(path: string): Promise<void> }) {
  return <MarkdownContent value={text} onOpenLiteasyPath={onOpenPath} />;
}

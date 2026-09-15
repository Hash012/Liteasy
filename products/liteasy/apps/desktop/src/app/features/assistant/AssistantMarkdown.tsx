import { MarkdownContent, type MarkdownContentProps } from "../markdown/MarkdownContent";

export { normalizeMarkdownMathDelimiters as normalizeAssistantMathDelimiters } from "../markdown/MarkdownContent";

/** Assistant styling is an adapter over the shared rich-text renderer. */
export function AssistantMarkdown({ className = "assistant-markdown", ...props }: MarkdownContentProps) {
  return <MarkdownContent {...props} className={className} />;
}

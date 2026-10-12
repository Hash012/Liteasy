import { ContentView } from "../markdown/ContentView";
import { legacyContent } from "../markdown/contentFragment";
import { type MarkdownContentProps } from "../markdown/MarkdownContent";

export { normalizeMarkdownMathDelimiters as normalizeAssistantMathDelimiters } from "../markdown/MarkdownContent";

/** Assistant styling is an adapter over the shared rich-text renderer. */
export function AssistantMarkdown({ className = "assistant-markdown", value, ...props }: MarkdownContentProps) {
  return <ContentView content={legacyContent(value)} {...props} className={className} />;
}

import { useMemo, type ReactNode } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import type { Root } from "mdast";
import { type Components } from "react-markdown";
import {
  MarkdownContent,
  normalizeMarkdownMathDelimiters
} from "../markdown/MarkdownContent";
import type { ThinReadingAnchor, ThinReadingSummarySentence } from "./thinReading.types";
import type { PaperAnchorEntity } from "../paper-anchors/paperAnchorEntity";

type SentenceRange = { end: number; sentence: ThinReadingSummarySentence; start: number };
type AnchorRange = { anchor: ThinReadingAnchor; end: number; start: number };
type MarkdownNode = {
  children?: MarkdownNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  position?: { end: { offset?: number }; start: { offset?: number } };
  type: string;
  value?: string;
};

type ThinReadingMarkdownProps = {
  activeAnchorId?: string | null;
  anchors: readonly ThinReadingAnchor[];
  generating: boolean;
  locale: "en" | "zh";
  marksVisible: boolean;
  onDeepen: (text: string, sentence: ThinReadingSummarySentence) => void;
  onSelectAnchor: (anchorId: string) => void;
  paperAnchors?: readonly PaperAnchorEntity[];
  renderReferences: (sentence: ThinReadingSummarySentence) => ReactNode;
  sentences: readonly ThinReadingSummarySentence[];
  summary: string;
};

/** Preserve the original Markdown separators instead of flattening its lists, tables and math. */
function buildMarkdownRanges(summary: string, sentences: readonly ThinReadingSummarySentence[]) {
  let markdown = normalizeMarkdownMathDelimiters(summary);
  let cursor = 0;
  let ranges: SentenceRange[] = [];
  for (const sentence of sentences) {
    const text = normalizeMarkdownMathDelimiters(sentence.text);
    const start = markdown.indexOf(text, cursor);
    if (start < 0) {
      // Old artifacts sometimes store an edited summary alongside the authoritative evidence text.
      markdown = sentences.map((entry) => normalizeMarkdownMathDelimiters(entry.text)).join("\n\n");
      cursor = 0;
      ranges = sentences.map((entry) => {
        const length = normalizeMarkdownMathDelimiters(entry.text).length;
        const range = { end: cursor + length, sentence: entry, start: cursor };
        cursor += length + 2;
        return range;
      });
      return { markdown, ranges };
    }
    ranges.push({ end: start + text.length, sentence, start });
    cursor = start + text.length;
  }
  return { markdown, ranges };
}

function spanNode(children: MarkdownNode[], properties: Record<string, unknown>): MarkdownNode {
  return { children, data: { hName: "span", hProperties: properties }, type: "thinReadingSpan" };
}

function sentenceProperties(sentence: ThinReadingSummarySentence | undefined) {
  return sentence ? {
    className: ["thin-reading__summary-sentence"],
    "data-thin-reading-summary-evidence-ids": sentence.evidenceIds.join(","),
    "data-thin-reading-summary-external-source-ids": sentence.externalKnowledge.join(",")
  } : {};
}

function readingMarkupPlugin(ranges: SentenceRange[], anchors: AnchorRange[]) {
  return function remarkReadingMarkup() {
    return (tree: Root) => {
      const root = tree as unknown as MarkdownNode;
      const lastLeafBySentence = new Map<string, MarkdownNode>();
      const referencedSentenceIds = new Set<string>();
      const rangesFor = (node: MarkdownNode) => ranges.filter((range) =>
        range.start < (node.position?.end.offset ?? 0) && range.end > (node.position?.start.offset ?? 0)
      );
      function collectLeaves(node: MarkdownNode) {
        // References must be siblings of Markdown links, never nested interactive controls.
        if (node.type === "link" || node.type === "linkReference") {
          rangesFor(node).forEach(({ sentence }) => lastLeafBySentence.set(sentence.id, node));
        } else if (node.children?.length) node.children.forEach(collectLeaves);
        else if (["text", "inlineCode", "inlineMath", "math", "code", "image"].includes(node.type)) {
          rangesFor(node).forEach(({ sentence }) => lastLeafBySentence.set(sentence.id, node));
        }
      }
      collectLeaves(root);

      function referencesNode(sentence: ThinReadingSummarySentence) {
        referencedSentenceIds.add(sentence.id);
        return spanNode([], {
          ...sentenceProperties(sentence),
          "data-thin-reading-references": sentence.id
        });
      }

      function transform(parent: MarkdownNode, inLink = false) {
        parent.children = parent.children?.flatMap((node): MarkdownNode[] => {
          const nodeRanges = rangesFor(node);
          let nextNodes = [node];
          if (node.type === "text" && node.value) {
            const start = node.position?.start.offset ?? 0;
            const text = node.value;
            // Markdown escapes/entities change source lengths. Keep their text intact rather
            // than assigning an anchor to a guessed offset.
            const exactOffsets = node.position?.end.offset === start + text.length;
            const marks = exactOffsets && !inLink
              ? anchors.filter((range) => range.start >= start && range.end <= start + text.length)
              : [];
            const terms = !inLink ? [...text.matchAll(/\[\[\[([^\[\]\r\n]{1,240})\]\]\]/gu)] : [];
            const cuts = new Set([0, text.length]);
            if (exactOffsets) {
              nodeRanges.forEach((range) => {
                cuts.add(Math.max(0, range.start - start));
                cuts.add(Math.min(text.length, range.end - start));
              });
            }
            marks.forEach((range) => { cuts.add(range.start - start); cuts.add(range.end - start); });
            terms.forEach((term) => { cuts.add(term.index); cuts.add(term.index + term[0].length); });
            const orderedCuts = [...cuts].sort((left, right) => left - right);
            nextNodes = [];
            let termEnd = -1;
            for (let index = 0; index < orderedCuts.length - 1; index += 1) {
              const from = orderedCuts[index];
              const to = orderedCuts[index + 1];
              if (from < termEnd) continue;
              const sentence = (exactOffsets
                ? nodeRanges.find((range) => range.start <= start + from && range.end > start + from)
                : nodeRanges[0])?.sentence;
              const term = terms.find((match) => match.index === from);
              const mark = marks.find((range) => range.start <= start + from && range.end >= start + to);
              if (term && sentence && term[1].trim()) {
                termEnd = from + term[0].length;
                nextNodes.push(spanNode([{ type: "text", value: term[1].trim() }], {
                  ...sentenceProperties(sentence),
                  "data-thin-reading-term": term[1].trim(),
                  "data-thin-reading-sentence-id": sentence.id
                }));
              } else {
                nextNodes.push(spanNode([{ type: "text", value: text.slice(from, to) }], {
                  ...sentenceProperties(sentence),
                  ...(mark ? { "data-thin-reading-mark": mark.anchor.id } : {})
                }));
              }
              const sentenceEnd = nodeRanges.find((range) => range.sentence === sentence)?.end ?? 0;
              if (sentence && lastLeafBySentence.get(sentence.id) === node &&
                !referencedSentenceIds.has(sentence.id) &&
                (exactOffsets ? start + Math.max(to, termEnd) >= Math.min(sentenceEnd, start + text.length) : to === text.length)) {
                nextNodes.push(referencesNode(sentence));
              }
            }
          } else if (node.children) {
            transform(node, inLink || node.type === "link" || node.type === "linkReference");
          } else if (nodeRanges.length > 0) {
            node.data = {
              ...node.data,
              hProperties: {
                ...node.data?.hProperties,
                "data-thin-reading-summary-evidence-ids": nodeRanges[0].sentence.evidenceIds.join(","),
                "data-thin-reading-summary-external-source-ids": nodeRanges[0].sentence.externalKnowledge.join(",")
              }
            };
          }
          const references = nodeRanges.filter(({ sentence }) =>
            lastLeafBySentence.get(sentence.id) === node && !referencedSentenceIds.has(sentence.id)
          ).map(({ sentence }) => referencesNode(sentence));
          if (references.length > 0) {
            nextNodes.push(...(["math", "code"].includes(node.type)
              ? [{ children: references, type: "paragraph" }]
              : references));
          }
          return nextNodes;
        });
      }
      transform(root);
    };
  };
}

/** Rich prose keeps sentence evidence and association marks while exposing explicit next layers. */
export function ThinReadingMarkdown({
  activeAnchorId, anchors, generating, locale, marksVisible, onDeepen, onSelectAnchor,
  paperAnchors, renderReferences, sentences, summary
}: ThinReadingMarkdownProps) {
  const { markdown, ranges } = useMemo(() => buildMarkdownRanges(summary, sentences), [summary, sentences]);
  const sentenceById = new Map(sentences.map((sentence) => [sentence.id, sentence]));
  const anchorById = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  const plugin = useMemo(() => readingMarkupPlugin(ranges, anchors.flatMap((anchor) => {
    const range = ranges.find(({ sentence }) => sentence.id === anchor.summarySentenceId);
    if (!range || range.sentence.text.slice(anchor.start, anchor.end) !== anchor.text) return [];
    const start = range.start + normalizeMarkdownMathDelimiters(range.sentence.text.slice(0, anchor.start)).length;
    return [{ anchor, end: start + anchor.text.length, start }];
  })), [anchors, ranges]);
  const components: Components = {
    a: ({ children, href, node: _node, ...props }) => {
      if (href?.startsWith("#")) return <a {...props} href={href}>{children}</a>;
      return /^https?:\/\//u.test(href ?? "")
        ? <a {...props} href={href} rel="noreferrer" target="_blank">{children}</a>
        : <span>{children}</span>;
    },
    span: ({ children, node, ...props }) => {
      const properties = node?.properties ?? {};
      const sentence = sentenceById.get(String(properties["data-thin-reading-sentence-id"] ?? ""));
      const term = properties["data-thin-reading-term"];
      if (typeof term === "string" && sentence) {
        const label = locale === "zh" ? `深入阅读“${term}”` : `Read more about “${term}”`;
        return (
          <Tooltip content={locale === "zh" ? "点击生成下一层薄读" : "Generate the next reading layer"} relationship="description">
            <Button
              appearance="transparent"
              aria-label={label}
              className="thin-reading__deepen-term"
              data-thin-reading-summary-evidence-ids={sentence.evidenceIds.join(",")}
              data-thin-reading-summary-external-source-ids={sentence.externalKnowledge.join(",")}
              disabled={generating}
              onClick={() => onDeepen(term, sentence)}
              size="small"
              title={label}
            >{children}</Button>
          </Tooltip>
        );
      }
      const referenceSentence = sentenceById.get(String(properties["data-thin-reading-references"] ?? ""));
      if (referenceSentence) return <span {...props}>{renderReferences(referenceSentence)}</span>;
      const anchor = anchorById.get(String(properties["data-thin-reading-mark"] ?? ""));
      if (anchor) {
        return (
          <mark
            aria-label={marksVisible ? `查看“${anchor.text}”关联论文` : undefined}
            aria-pressed={marksVisible ? activeAnchorId === anchor.id : undefined}
            className={`thin-reading__anchor${marksVisible ? "" : " is-hidden"}${activeAnchorId === anchor.id ? " is-active" : ""}`}
            data-anchor-id={anchor.id}
            data-thin-reading-anchor-id={anchor.id}
            data-thin-reading-summary-evidence-ids={anchor.evidenceIds.join(",")}
            data-thin-reading-summary-external-source-ids={anchor.externalSourceIds.join(",")}
            onClick={marksVisible ? () => onSelectAnchor(anchor.id) : undefined}
            onKeyDown={marksVisible ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectAnchor(anchor.id);
              }
            } : undefined}
            role={marksVisible ? "button" : undefined}
            tabIndex={marksVisible ? 0 : -1}
            title={marksVisible ? `${anchor.text} · ${Math.round(anchor.importance * 100)}%` : undefined}
          >{children}</mark>
        );
      }
      return <span {...props}>{children}</span>;
    }
  };
  return (
    <MarkdownContent
      className="assistant-markdown thin-reading__markdown"
      components={components}
      normalizeMath={false}
      paperAnchors={paperAnchors}
      remarkPlugins={[plugin]}
      streaming={generating}
      value={markdown}
    />
  );
}

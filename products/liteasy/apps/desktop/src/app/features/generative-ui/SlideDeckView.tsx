import { Button, Select, Tooltip } from "@fluentui/react-components";
import { ChevronLeftRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { MarkdownContent } from "../markdown/MarkdownContent";
import { formatPaperAnchorText, type PaperAnchorEntity } from "../paper-anchors/paperAnchorEntity";
import { PaperAnchorReferences } from "../paper-anchors/PaperAnchorReferences";
import "./slideDeckView.css";

type SlideDeckViewProps = {
  onOpenPaperAnchor?: (anchor: PaperAnchorEntity) => void;
  paperAnchors?: readonly PaperAnchorEntity[];
  slides: readonly Record<string, unknown>[];
  title: string;
};

function text(slide: Record<string, unknown>, key: string, fallback = "") {
  return typeof slide[key] === "string" ? slide[key] as string : fallback;
}

/** Mount one page and its requested notes; a long deck must not start every chart renderer at once. */
export function SlideDeckView({ onOpenPaperAnchor, paperAnchors, slides, title }: SlideDeckViewProps) {
  const [selected, setSelected] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const index = Math.min(selected, Math.max(0, slides.length - 1));
  const slide = slides[index];
  const bullets = Array.isArray(slide?.bullets) ? slide.bullets.filter((item): item is string => typeof item === "string") : [];
  const markdown = slide ? text(slide, "markdown") : "";
  const notes = slide ? text(slide, "notes") : "";
  const evidenceIds = new Set(Array.isArray(slide?.evidenceIds) ? slide.evidenceIds : []);
  const slideAnchors = paperAnchors?.filter((anchor) => anchor.evidenceIds.some((id) => evidenceIds.has(id))) ?? [];
  return (
    <section className="genui-slide-deck" aria-label={formatPaperAnchorText(title, paperAnchors)}>
      <strong>{formatPaperAnchorText(title, paperAnchors)}</strong>
      {!slide ? <p>暂无幻灯片。</p> : <>
        <nav className="slide-deck-navigation" aria-label="幻灯片导航">
          <Tooltip content="上一页" relationship="label">
            <Button appearance="subtle" aria-label="上一页幻灯片" disabled={index === 0} icon={<ChevronLeftRegular />} onClick={() => setSelected(index - 1)} size="small" />
          </Tooltip>
          <Select aria-label="选择幻灯片" value={String(index)} onChange={(_, data) => setSelected(Number(data.value))}>
            {slides.map((item, itemIndex) => <option key={itemIndex} value={itemIndex}>
              {itemIndex + 1}. {formatPaperAnchorText(text(item, "title", `第 ${itemIndex + 1} 页`), paperAnchors)}
            </option>)}
          </Select>
          <span role="status">{index + 1} / {slides.length}</span>
          <Tooltip content="下一页" relationship="label">
            <Button appearance="subtle" aria-label="下一页幻灯片" disabled={index === slides.length - 1} icon={<ChevronRightRegular />} onClick={() => setSelected(index + 1)} size="small" />
          </Tooltip>
        </nav>
        <article className="genui-slide slide-deck-page" aria-label={`第 ${index + 1} 页幻灯片`} key={text(slide, "id", String(index))}>
          <h3><MarkdownContent inline paperAnchors={paperAnchors} value={text(slide, "title", `第 ${index + 1} 页`)} /></h3>
          {markdown ? <MarkdownContent paperAnchors={paperAnchors} value={markdown} /> : <ul>
            {bullets.map((bullet, bulletIndex) => <li key={bulletIndex}><MarkdownContent paperAnchors={paperAnchors} value={bullet} /></li>)}
          </ul>}
          <PaperAnchorReferences anchors={slideAnchors} label="本页引用原文" onOpen={onOpenPaperAnchor} />
        </article>
        {notes ? <div className="slide-deck-notes">
          <Button appearance="subtle" aria-expanded={showNotes} onClick={() => setShowNotes(!showNotes)} size="small">
            {showNotes ? "收起演讲备注" : "显示演讲备注"}
          </Button>
          {showNotes ? <div aria-label="演讲备注"><MarkdownContent paperAnchors={paperAnchors} value={notes} /></div> : null}
        </div> : null}
      </>}
    </section>
  );
}

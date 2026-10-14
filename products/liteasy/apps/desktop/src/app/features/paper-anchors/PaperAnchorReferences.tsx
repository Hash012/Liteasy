import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { ResourceLink } from "../resource-links/ResourceReferenceView";
import { ArrowExpandRegular } from "@fluentui/react-icons";
import { DisclosureSection } from "../../shared/ui/productPrimitives";
import { useObjectWorkbench } from "../objects/objectWorkbenchPort";
import { Button } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { ContentView } from "../markdown/ContentView";
import { legacyContent } from "../markdown/contentFragment";
import {
  formatPaperAnchorText,
  paperAnchorLabel,
  type PaperAnchorEntity,
} from "./paperAnchorEntity";
import "./paperAnchors.css";

/** All prose surfaces use the entity's fixed, below-content citation view. */
export function PaperAnchorReferences({ anchors, onOpen, label = "查看引用原文", open = true, className = "" }: {
  anchors: readonly PaperAnchorEntity[];
  onOpen?: (anchor: PaperAnchorEntity) => void;
  label?: string;
  open?: boolean;
  className?: string;
}) {
  const { tChinese } = useUiTranslation();
  const workbench = useObjectWorkbench();
  const navigate = onOpen ?? workbench?.openPaperAnchor;
  const [navigationError, setNavigationError] = useState("");
  const [visibleCount, setVisibleCount] = useState(12);
  useEffect(() => setVisibleCount(12), [anchors]);
  if (!anchors.length) return null;
  return <DisclosureSection className={`paper-anchor-references ${className}`} defaultOpen={open} title={<>{label}</>}>

    <ol>
      {anchors.slice(0, visibleCount).map((anchor, index) => <li key={`${anchor.id}:${index}`} data-paper-anchor-id={anchor.id}>
        <ResourceLink locator={`paper-anchor:${anchor.id}`} previewOnClick preview={<>
          <strong>{paperAnchorLabel(anchor)}</strong>
          <ContentView content={legacyContent(anchor.snapshot.quote)} />
          <span>{anchor.source.documentHash ? tChinese("preview.sourcePinned", "已固定来源版本") : tChinese("preview.sourceUnpinned", "来源版本未记录")} · {anchor.source.selector?.type === "pdf" && anchor.source.selector.rects?.length ? tChinese("preview.sourceRect", "已记录原文区域") : anchor.locator.precision === "text" ? tChinese("preview.sourceText", "已记录文字位置") : anchor.locator.page ? tChinese("preview.sourcePage", "仅记录页码") : tChinese("preview.sourceQuote", "仅保留摘录")}</span>
          {navigate && anchor.locator.page ? <Button size="small" onClick={() => { void Promise.resolve().then(() => navigate(anchor)).catch((error) => setNavigationError(error instanceof Error ? error.message : "来源暂不可用。")); }}>{tChinese("preview.openOriginal", "打开原文")}</Button> : null}
        </>}>{paperAnchorLabel(anchor)}</ResourceLink>
        <Button
          icon={<ArrowExpandRegular />}
          title={tChinese("preview.openOriginal", "打开原文")}
          appearance="subtle"
          aria-label={`打开原文证据 ${index + 1}：${formatPaperAnchorText(anchor.presentation.title)} ${formatPaperAnchorText(anchor.presentation.location)}`}
          disabled={!navigate || !anchor.locator.page}
          onClick={() => {
            setNavigationError("");
            const failed = (error: unknown) => setNavigationError(error instanceof Error
              ? error.message : "来源暂时不可用，原文摘录仍可阅读。");
            try { void Promise.resolve(navigate?.(anchor)).catch(failed); } catch (error) { failed(error); }
          }}
          size="small"
        >{tChinese("preview.open", "打开")}</Button>
        {anchor.snapshot.quote ? <blockquote><ContentView content={legacyContent(anchor.snapshot.quote)} /></blockquote> : null}
        {anchor.snapshot.summary && anchor.snapshot.summary !== anchor.snapshot.quote ? (
          <p>摘要：{formatPaperAnchorText(anchor.snapshot.summary)}</p>
        ) : null}
        {!anchor.locator.page ? <span>来源位置未记录，保留原文摘录。</span> : null}
      </li>)}
    </ol>
    {navigationError ? <p role="status">{navigationError}</p> : null}
    {visibleCount < anchors.length ? <Button appearance="subtle" size="small"
      onClick={() => setVisibleCount((current) => current + 12)}>
      显示更多引用（剩余 {anchors.length - visibleCount} 条）
    </Button> : null}
  </DisclosureSection>;
}

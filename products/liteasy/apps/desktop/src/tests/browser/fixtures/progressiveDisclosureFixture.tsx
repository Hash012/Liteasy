import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Menu, MenuTrigger, MenuPopover, MenuList, MenuItem } from "@fluentui/react-components";
import { MoreHorizontalRegular } from "@fluentui/react-icons";
import { ApplicationThemeProvider } from "../../../app/features/theme/ApplicationThemeProvider";
import { notifyAppearancePreference } from "../../../app/features/theme/appearancePreference";
import { ContextualActions, IconAction, ActionButton } from "../../../app/shared/ui/productPrimitives";
import { RecommendationList } from "../../../app/features/recommendations/RecommendationList";
import { PdfReaderToolbar } from "../../../app/features/pdf/PdfReaderToolbar";
import { FileStatusBar } from "../../../app/layout/FileStatusBar";
import type { RecommendationItem } from "../../../app/features/recommendations/recommendation.types";
import "../../../app/styles/app.css";
import "../../../app/styles/workspaceShell.css";
import "../../../app/features/theme/appearance.css";
const item: RecommendationItem = { id: "synthetic", title: "<p>中文标题 Memory systems and reproducible scientific results with very long names</p>", authors: ["Synthetic author"], publishedYear: 2024, reason: "离线合成资料推荐理由", source: "Synthetic", sourceKind: "live", discoveredAt: "2026-10-13", relevanceBand: "high", relevanceScore: 0.9 };
function Fixture() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<RecommendationItem>();
  const [notice, setNotice] = useState("");
  const [textBox, setTextBox] = useState(false);
  const noop = () => {};
  return <ApplicationThemeProvider><main style={{ padding: 16 }}>
    <ActionButton onClick={() => notifyAppearancePreference("dark")}>深色</ActionButton>
    <ActionButton onClick={() => notifyAppearancePreference("light")}>浅色</ActionButton>
    <section aria-label="验收侧栏" style={{ width: "var(--test-pane-width, 320px)", maxWidth: "100%" }}>
      <div className="product-contextual-owner" data-testid="owner" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span data-testid="owner-title">合成条目 Synthetic row</span>
        <ContextualActions menuOpen={menuOpen}><Menu open={menuOpen} onOpenChange={(_, d) => setMenuOpen(d.open)}><MenuTrigger disableButtonEnhancement><IconAction density="compact" label="条目更多操作" icon={<MoreHorizontalRegular />} /></MenuTrigger><MenuPopover><MenuList><MenuItem onClick={() => setNotice("已执行条目操作")}>检查条目</MenuItem></MenuList></MenuPopover></Menu></ContextualActions>
      </div>
      <RecommendationList items={[item, { ...item, id: "second", title: "另一篇合成资料", publishedYear: 2025 }]} pendingIds={[]} canSave selectedId={selected?.id} onInspect={setSelected} onOpen={value => setNotice(`打开 ${value.id}`)} onSave={value => setNotice(`收藏 ${value.id}`)} onDismiss={value => setNotice(`忽略 ${value.id}`)} />
      <PdfReaderToolbar activeSearchIndex={0} currentPage={1} layoutMode="continuous" matchCase={false} marginCommentsVisible={false} marginCommentConnectorsVisible={false} whiteboardOpen={false} onChangeLayoutMode={noop} onChangeMatchCase={noop} onChangePage={noop} onChangeSearchQuery={noop} onChangeWholeWords={noop} onCloseSearch={noop} onFindNext={noop} onFindPrevious={noop} onNavigateNext={noop} onNavigatePrevious={noop} onOpenSearch={noop} onToggleMarginComments={noop} onToggleMarginCommentConnectors={noop} onToggleTextBoxTool={() => setTextBox(!textBox)} onToggleWhiteboard={noop} onZoomIn={noop} onZoomOut={noop} pageCount={10} searchOpen={false} searchQuery="" searchResultCount={0} textBoxToolActive={textBox} wholeWords={false} zoom={100} />
      <FileStatusBar status={{ name: "超长题名".repeat(25), type: "推荐文献", recommendation: item }} />
    </section><output>{notice}</output>
  </main></ApplicationThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

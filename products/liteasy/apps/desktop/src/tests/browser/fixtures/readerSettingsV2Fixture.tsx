import { createRoot } from "react-dom/client";
import { useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ApplicationThemeProvider } from "../../../app/features/theme/ApplicationThemeProvider";
import { notifyAppearancePreference } from "../../../app/features/theme/appearancePreference";
import { ActionButton } from "../../../app/shared/ui/productPrimitives";
import { SelectionLookupSettingsPanel } from "../../../app/features/selection-lookup/SelectionLookupSettingsPanel";
import { ModelConnectionPanel } from "../../../app/features/models/ModelConnectionPanel";
import { PdfOutline } from "../../../app/features/pdf/PdfOutline";
import { PaperReviewSharePanel } from "../../../app/features/pdf/PaperReviewSharePanel";
import { PdfAppearanceControl, type PdfAppearance } from "../../../app/features/pdf/PdfAppearanceControl";
import type { SettingsState } from "../../../app/features/settings/settings.types";
import "../../../app/styles/app.css";
import "../../../app/styles/workspaceShell.css";
import "../../../app/features/settings/settingsPage.css";
import "../../../app/features/pdf/pdfNavigationViews.css";
import "../../../app/features/theme/appearance.css";
const document = { numPages: 9, getOutline: async () => [{ title: "第一章：研究背景与可复现性 Research background", dest: [0], items: [{ title: "方法与证据 Methods and evidence", dest: [3], items: [] }] }] } as unknown as PDFDocumentProxy;
function Fixture() {
  const [settings, setSettings] = useState<Partial<SettingsState>>({ "lookup.translation_service": "libretranslate" });
  const [appearance, setAppearance] = useState<PdfAppearance>({ background: "paper", customBackground: "#ffffff", preserveImages: true });
  const [page, setPage] = useState(1);
  return <ApplicationThemeProvider><main style={{ padding: 12 }}>
    <ActionButton onClick={() => notifyAppearancePreference("dark")}>深色</ActionButton><ActionButton onClick={() => notifyAppearancePreference("light")}>浅色</ActionButton>
    <div className="settings-page" data-testid="review-settings" style={{ width: "var(--test-pane-width, 520px)", maxWidth: "100%", height: "auto" }}>
      <h2>查词与翻译</h2><SelectionLookupSettingsPanel settings={settings} onUpdateSetting={(command) => setSettings((current) => ({ ...current, [command.target]: command.value }))} />
      <h2>模型与连接</h2><ModelConnectionPanel onUpdateSetting={() => {}} />
    </div>
    <section aria-label="阅读局部控件" style={{ width: "var(--test-pane-width, 520px)", maxWidth: "100%" }}>
      <div className="pdf-annotation-toolbar"><PaperReviewSharePanel scopeKey="synthetic" ready hostAvailable source={{ title: "Synthetic", annotations: [], pageTexts: {} }} /><PdfAppearanceControl value={appearance} onChange={setAppearance} /></div>
      <PdfOutline document={document} onNavigate={(target) => setPage(target.page)} /><output>当前页 {page}</output>
    </section>
  </main></ApplicationThemeProvider>;
}
createRoot(window.document.getElementById("root")!).render(<Fixture />);

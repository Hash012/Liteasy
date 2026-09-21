import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createRoot } from "react-dom/client";
import { PdfReader } from "../../app/features/pdf/PdfReader";
import { pdfAnnotationStorageKey, savePdfAnnotations } from "../../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../../app/features/paper-identity/paperIdentity";

export function mountPaperReviewBrowserFixture(container: HTMLElement) {
  const paper = { id: "review-browser-fixture", title: "Contrastive retrieval: review fixture" };
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [{
    id: "comment-1", kind: "highlight", revision: 1, page: 1, text: "高亮",
    excerpt: "The evaluation compares retrieval quality on held-out queries.",
    note: "这里的 held-out queries 是否与训练数据完全独立？需要检查作者如何排除数据泄漏。",
    rects: [], paperIdentity: resolvePaperIdentity(paper), createdAt: "2026-09-21", updatedAt: "2026-09-21",
    publication: { desiredVisibility: "private", state: "not_published" },
  }]);
  // Only the availability marker is supplied. Native transport is tested separately.
  Object.assign(globalThis, { isTauri: true });
  const root = createRoot(container);
  root.render(<FluentProvider theme={webLightTheme}>
    <main style={{ height: "100vh", minWidth: 0 }}><PdfReader selectedPapers={[paper]} zoom={100} /></main>
  </FluentProvider>);
  return () => root.unmount();
}

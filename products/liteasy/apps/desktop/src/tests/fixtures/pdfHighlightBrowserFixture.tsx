import { AppShell } from "../../app/layout/AppShell";
import type { Paper } from "../../app/features/workspace/workspace.types";

const previewPaper: Paper = {
  id: "manual-das24a-preview",
  sourcePath: new URL("/manual-preview/das24a.pdf", window.location.origin).href,
  title: "das24a.pdf"
};

export default function PdfHighlightBrowserFixture() {
  return <AppShell initialOpenReaderPaperIds={[previewPaper.id]} initialPapers={[previewPaper]} />;
}

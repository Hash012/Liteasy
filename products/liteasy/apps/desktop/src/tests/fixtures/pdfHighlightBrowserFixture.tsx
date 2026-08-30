import { PdfReader } from "../../app/features/pdf/PdfReader";
import type { Paper } from "../../app/features/workspace/workspace.types";

const previewPaper: Paper = {
  id: "manual-das24a-preview",
  sourcePath: new URL("/manual-preview/das24a.pdf", window.location.origin).href,
  title: "das24a.pdf"
};

export default function PdfHighlightBrowserFixture() {
  return (
    <main style={{ height: "100vh", minWidth: 0, overflow: "hidden" }}>
      <PdfReader selectedPapers={[previewPaper]} zoom={100} />
    </main>
  );
}

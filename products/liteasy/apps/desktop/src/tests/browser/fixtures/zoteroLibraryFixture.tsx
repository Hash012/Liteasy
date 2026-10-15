import { createRoot } from "react-dom/client";
import { ApplicationThemeProvider } from "../../../app/features/theme/ApplicationThemeProvider";
import { LibraryTagChips } from "../../../app/features/library/LibraryTagChips";
import { ReadingLibraryCatalog } from "../../../app/features/library/ReadingLibraryCatalog";
import { BibliographicMetadataEditor } from "../../../app/features/library/BibliographicMetadataEditor";
import { bibliographicDraft } from "../../../app/features/library/bibliographicFields";
import "../../../app/styles/app.css";
import "../../../app/features/settings/applicationView.css";
import "../../../app/features/library/library.css";

const entries = Array.from({ length: 123 }, (_, index) => ({ id: String(index), title: `文献 ${String(index + 1).padStart(3, "0")}`, format: "pdf" as const, authors: ["Research Author"], year: 2026, tags: ["待读"], addedAt: new Date(2026, 0, 124 - index).toISOString() }));
const size = Number(new URLSearchParams(location.search).get("font")) || 14;
document.documentElement.style.setProperty("--app-font-size", `${size}px`);
document.documentElement.style.setProperty("--app-font-ratio", String(size / 14));
createRoot(document.getElementById("root")!).render(<ApplicationThemeProvider>
  <main style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)", height: "100vh" }}>
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}><LibraryTagChips entry={entries[0]} /><ReadingLibraryCatalog entries={entries} onImport={() => {}} onOpen={() => {}} /></div>
    <BibliographicMetadataEditor model={{ entry: entries[0], draft: bibliographicDraft(entries[0]), editing: true, dirty: true, pending: false, error: "", message: "", change() {}, reload() {}, async save() {} }} />
  </main>
</ApplicationThemeProvider>);

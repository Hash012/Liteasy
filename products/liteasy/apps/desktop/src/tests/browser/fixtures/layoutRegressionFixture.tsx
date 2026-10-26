import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider, webLightTheme } from "@fluentui/react-components";
import { AssistantComposer } from "../../../app/features/assistant/AssistantComposer";
import { insertContextMentions, mapContextMentions } from "../../../app/features/assistant/inlineContext";
import type { AssistantContextToken } from "../../../app/features/assistant/assistant.types";
import { PaperReadingWorkspace } from "../../../app/features/paper-reading/PaperReadingWorkspace";
import type { PdfReadingAnnotations } from "../../../app/features/pdf/pdfReadingAnnotations";
import { DockRegion } from "../../../app/features/dock/DockRegion";
import type { DockRegionId } from "../../../app/features/dock/dock.types";
import { useImmersiveReadingController } from "../../../app/controllers/useImmersiveReadingController";
import "../../../app/styles/app.css";
import "../../../app/shared/ui/productPrimitives.css";
import "../../../app/styles/workspaceShell.css";
import "../../../app/styles/immersiveReading.css";

const params = new URLSearchParams(location.search);
const skill: AssistantContextToken = { id: "skill-test", kind: "skill", label: params.has("long") ? "Review several paper sections" : "Skill", prompt: "" };
const initial = insertContextMentions("Before  after\nNext line", [], [skill], { input: "Before  after\nNext line", start: 7, end: 7 });

function ComposerFixture() {
  const [draft, setDraft] = useState(initial);
  return <main data-testid="composer-host" style={{ width: params.has("long") ? 240 : 620, margin: 20 }}>
    <AssistantComposer input={draft.input} contextTokens={draft.tokens} contextScopeId="layout:skill" modeHint="提问"
      onInputChange={input => setDraft(previous => ({ ...previous, input, tokens: mapContextMentions(previous.input, input, previous.tokens) }))}
      onRemoveContextToken={id => setDraft(previous => ({ ...previous, tokens: previous.tokens.filter(token => token.id !== id) }))}
      onSend={() => {}} onVoiceInput={() => {}} />
  </main>;
}

const session: PdfReadingAnnotations = {
  scopeKey: "layout:reading", ready: true, annotations: [], pageTexts: { 1: "Sample paper" }, pageCount: 1, focusedPage: 1,
  create: async () => {}, update: async () => {}, remove: async () => {}, openPdf: () => {},
};
function ReadingFixture() {
  return <section data-testid="reading-host" style={{ display: "flex", width: 300, height: 700, margin: 20, border: "1px solid #aaa" }}>
    <PaperReadingWorkspace session={session} chunks={[]}>
      <div className="paper-resource-tab" style={{ height: "100%", overflow: "auto" }}>
        <article className="mineru-markdown"><h2>Sample paper</h2><p>{"A reading pane keeps its source text visible while a sidebar is open. ".repeat(30)}</p></article>
      </div>
    </PaperReadingWorkspace>
  </section>;
}

const horizontal: DockRegionId[] = ["left", "main", "bar-test", "right"];
function DockFixture() {
  const immersive = useImmersiveReadingController();
  function renderRegion(regionId: DockRegionId) {
    return <DockRegion key={regionId} regionId={regionId} layout={{ itemIds: ["document-reader"], activeItemId: "document-reader" }}
      readingFocusTarget={immersive.active && immersive.regionId === regionId} itemTitles={{ "document-reader": `Reader ${regionId}` }}
      onActivateItem={() => {}} onCloseItem={() => {}} onMoveItem={() => {}}
      renderItem={() => <section className="reading-document" style={{ height: "100%", overflow: "auto" }}>
        <header className="reading-document__toolbar">Reader tools</header>
        <p>Text in {regionId}</p><textarea aria-label={`Draft in ${regionId}`} defaultValue={`Unsaved ${regionId}`} />
        <p>{"Persistent reader text. ".repeat(80)}</p>
      </section>} />;
  }
  return <div ref={immersive.root} className="app-frame workspace-frame" data-reading-focus={immersive.mode}
    data-reading-focus-region={immersive.regionId} data-focus-edge={immersive.edge} onClickCapture={immersive.onClickCapture}>
    <header className="workspace-command-bar"><Button onClick={immersive.enter}>Read</Button><Button onClick={immersive.toggleFullscreen}>Fullscreen</Button><Button onClick={immersive.exit}>Exit</Button></header>
    <main className="app-shell">
      <aside className="activity-bar">Tools</aside>
      <div className="dock-workspace-columns" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>{horizontal.map(renderRegion)}</div>
      <div className="pane-utility-row bottom"><div className="pane-resizer vertical" /></div>
      <div className="dock-bottom-columns" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>{renderRegion("bottom")}</div>
    </main>
    <footer className="file-status-bar">Document status</footer>
  </div>;
}

createRoot(document.getElementById("root")!).render(<FluentProvider theme={webLightTheme}>
  {params.get("scenario") === "reading" ? <ReadingFixture /> : params.get("scenario") === "dock" ? <DockFixture /> : <ComposerFixture />}
</FluentProvider>);

import { LibraryPane } from "../features/library/LibraryPane";
import { AssistantPane } from "../features/assistant/AssistantPane";
import liteasyClawLogo from "../../assets/liteasyclaw-logo.jpg";

export function AppShell() {
  return (
    <div className="app-frame">
      <header className="app-topbar">
        <div className="brand">
          <img alt="LiteasyClaw Logo" className="brand-logo" src={liteasyClawLogo} />
          <div className="brand-meta">
            <div className="brand-name">LiteasyClaw</div>
            <div className="brand-tagline">AI-driven paper-assisted reading platform</div>
          </div>
        </div>
      </header>

      <div className="app-shell">
        <aside className="pane left">
          <div className="pane-header">Library</div>
          <div className="pane-body">
            <LibraryPane />
          </div>
        </aside>
        <main className="pane center">
          <div className="pane-header">Reader</div>
          <div className="pane-body">文献阅读与多模态标签页区域</div>
        </main>
        <section className="pane right">
          <div className="pane-header">Assistant</div>
          <div className="pane-body">
            <AssistantPane />
          </div>
        </section>
      </div>
    </div>
  );
}

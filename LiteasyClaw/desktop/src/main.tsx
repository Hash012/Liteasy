import React from "react";
import ReactDOM from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import App from "./App";
import { ThinReadingTab } from "./app/features/thin-reading/ThinReadingTab";
import { createThinReadingFixture } from "./app/features/thin-reading/thinReadingFixtures";
import { createThinReadingDocument } from "./app/features/thin-reading/thinReadingProjection";
import "./app/styles/app.css";

const browserFixture = import.meta.env.DEV && window.location.search.includes("thin-reading-fixture");
const fixture = browserFixture ? createThinReadingFixture() : null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FluentProvider theme={webLightTheme} className="fluent-app-root">
      {fixture ? <ThinReadingTab
        artifactId={fixture.artifactId}
        document={createThinReadingDocument(fixture)}
        onUpdateDocument={() => undefined}
        papers={[...fixture.papers]}
      /> : <App />}
    </FluentProvider>
  </React.StrictMode>,
);

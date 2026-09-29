import React from "react";
import ReactDOM from "react-dom/client";
import { restoreWebDavPreferences, reportWebDavRestoreError } from "./app/features/webdav/webdavPreferences";
import { ApplicationThemeProvider, initializeApplicationAppearance } from "./app/features/theme/ApplicationThemeProvider";
import "./app/styles/app.css";
import "./app/features/theme/appearance.css";

async function start() {
  try { await restoreWebDavPreferences(); } catch (error) { reportWebDavRestoreError(error); }
  const { default: App } = await import("./App");
  initializeApplicationAppearance();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ApplicationThemeProvider>
        <App />
      </ApplicationThemeProvider>
    </React.StrictMode>
  );
}
void start();

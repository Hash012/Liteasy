import React from "react";
import ReactDOM from "react-dom/client";
import { restoreWebDavPreferences, reportWebDavRestoreError } from "./app/features/webdav/webdavPreferences";
import { ApplicationThemeProvider, initializeApplicationAppearance } from "./app/features/theme/ApplicationThemeProvider";
import "./app/styles/app.css";
import "./app/features/theme/appearance.css";

async function start() {
  if (import.meta.env.DEV && import.meta.env.VITE_LITEASY_LOCAL_ONLY === "1") {
    const { initializeLocalDevelopment } = await import("./app/features/workbench/localDevelopment");
    initializeLocalDevelopment();
  }
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

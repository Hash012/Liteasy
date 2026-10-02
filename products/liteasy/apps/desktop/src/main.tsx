import React from "react";
import ReactDOM from "react-dom/client";
import { restoreWebDavPreferences, reportWebDavRestoreError } from "./app/features/webdav/webdavPreferences";
import { ApplicationThemeProvider, initializeApplicationAppearance } from "./app/features/theme/ApplicationThemeProvider";
import "./app/styles/app.css";
import "./app/features/theme/appearance.css";

async function start() {
  const { initializeRuntimeProfile } = await import("./app/features/local-recovery/runtimeProfile");
  const recovery = await initializeRuntimeProfile();
  if (recovery || import.meta.env.DEV && import.meta.env.VITE_LITEASY_LOCAL_ONLY === "1") {
    const { initializeLocalDevelopment } = await import("./app/features/workbench/localDevelopment");
    initializeLocalDevelopment();
  }
  if (!recovery) { try { await restoreWebDavPreferences(); } catch (error) { reportWebDavRestoreError(error); } }
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
void start().catch((error) => {
  const root = document.getElementById("root");
  if (root) { root.setAttribute("role", "alert"); root.textContent = `Liteasy 未能打开资料：${error instanceof Error ? error.message : String(error)}。原资料保持不变，请关闭此窗口后重试。`; }
});

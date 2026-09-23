import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ApplicationThemeProvider, initializeApplicationAppearance } from "./app/features/theme/ApplicationThemeProvider";
import "./app/styles/app.css";
import "./app/features/theme/appearance.css";

initializeApplicationAppearance();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ApplicationThemeProvider>
      <App />
    </ApplicationThemeProvider>
  </React.StrictMode>
);

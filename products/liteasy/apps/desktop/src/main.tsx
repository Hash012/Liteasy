import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProvider } from "./AppProvider";
import { RootErrorBoundary } from "./RootErrorBoundary";
import "./app/styles/app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </AppProvider>
  </React.StrictMode>
);

import React from "react";
import ReactDOM from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { AppShell } from "./app/layout/AppShell";
import "./app/styles/mobile.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><FluentProvider theme={webLightTheme}><AppShell /></FluentProvider></React.StrictMode>
);

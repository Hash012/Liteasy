import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationApp } from "./AnnotationApp";
import "./annotation-app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><AnnotationApp /></StrictMode>
);

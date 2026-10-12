import mermaid from "mermaid";
let mermaidInitialized = false;

export function initializeMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    fontFamily: "inherit",
    securityLevel: "strict",
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      edgeLabelBackground: "#ffffff",
      lineColor: "#697b8c",
      primaryBorderColor: "#8aa0b5",
      primaryColor: "#f7f9fb",
      primaryTextColor: "#172b3a",
      secondaryColor: "#eaf3ff",
      tertiaryColor: "#f3f7fb"
    }
  });
  mermaidInitialized = true;
}


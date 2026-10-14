import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider, webLightTheme, webDarkTheme } from "@fluentui/react-components";
import { ContextAssetBrowser } from "../../../app/features/assistant/ContextAssetBrowser";
import { createContextCatalogPort } from "../../../app/features/context-picker/catalogPort";
import { ResourceReferencesContext, type ResourceReferences } from "../../../app/features/resource-links/ResourceReferencesContext";
import { contextPickerScaleFixture } from "../../contextPickerScaleFixture";
const source = contextPickerScaleFixture(), catalog = createContextCatalogPort(source);
function Fixture() {
  const [open, setOpen] = useState(false), [dark, setDark] = useState(false);
  const references = { suggestions: source.assets, service: { scope: source.scope }, picker: { catalog, workspaceId: "scale", activePaperId: "paper-0" } } as ResourceReferences;
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme} style={{ minHeight: "100vh" }}><ResourceReferencesContext.Provider value={references}>
    <Button onClick={() => setOpen(true)}>添加上下文</Button><Button onClick={() => setDark(value => !value)}>切换主题</Button>
    {open ? <ContextAssetBrowser targetDraftId="scale-draft" suggestions={source.assets} onClose={() => setOpen(false)} onAddContextToken={() => {}} /> : null}
  </ResourceReferencesContext.Provider></FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

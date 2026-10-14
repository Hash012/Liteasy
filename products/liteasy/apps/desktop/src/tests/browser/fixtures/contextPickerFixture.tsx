import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, useRestoreFocusTarget, FluentProvider, webLightTheme } from "@fluentui/react-components";
import { ContextAssetBrowser } from "../../../app/features/assistant/ContextAssetBrowser";
import { contextPickerFixture } from "../../contextPickerFixture";
import type { AssistantContextToken } from "../../../app/features/assistant/assistant.types";
const fixture = contextPickerFixture(150);
function Fixture() {
  const restore = useRestoreFocusTarget();
  const [open, setOpen] = useState(false), [tokens, setTokens] = useState<AssistantContextToken[]>([]);
  return <FluentProvider theme={webLightTheme}><Button {...restore} onClick={() => setOpen(true)}>添加上下文</Button><output aria-label="草稿上下文">{tokens.length}</output>
    {open ? <ContextAssetBrowser targetDraftId="browser-draft" catalogPort={fixture.catalog} suggestions={fixture.assets} contextTokens={tokens} onClose={() => setOpen(false)} onAddContextToken={token => setTokens(values => [...values, token])} /> : null}
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

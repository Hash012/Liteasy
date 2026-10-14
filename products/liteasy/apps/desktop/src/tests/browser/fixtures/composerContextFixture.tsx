import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { AssistantComposer } from "../../../app/features/assistant/AssistantComposer";
import { insertContextMentions, mapContextMentions } from "../../../app/features/assistant/inlineContext";
import type { AssistantContextToken } from "../../../app/features/assistant/assistant.types";
import { createAgentAssetService, readAgentAssetText } from "../../../app/features/resource-filesystem/agentAssetService";
import { createResourceReferenceService } from "../../../app/features/resource-links/resourceReferenceService";
import { ResourceReferencesContext } from "../../../app/features/resource-links/ResourceReferencesContext";
import "../../../app/styles/app.css";
import "../../../app/shared/ui/productPrimitives.css";
const path = "liteasy://objects/review-source?scope=review&revision=v1";
const asset = { path, title: "Not All Samples Are Created Equal: Understanding Evidence · §2.4", kind: "content.note", revision: "v1", capabilities: ["read" as const] };
const token: AssistantContextToken = { id: "evidence", kind: "object", label: asset.title, prompt: "", resourcePath: path, contextRefs: [{ objectId: "review-source", revision: "v1" }] };
const assets = createAgentAssetService({ scopeId: "review", active: () => true, adapters: [{ id: "objects", accepts: value => value === path, search: async () => [asset], stat: async () => asset, read: async (_, options) => readAgentAssetText(asset, "## §2.4 Evidence\n\nThe selected evidence preserves its **source revision**.\n\nMeasured ratio: $10^{-1}$.", options) }] });
const service = createResourceReferenceService({ scope: "review", assets, catalog: () => [asset], active: () => true });
const initial = insertContextMentions("请比较 的证据", [], [token], { input: "请比较 的证据", start: 4, end: 4 });
function Fixture() {
  const [draft, setDraft] = useState(initial);
  const [sent, setSent] = useState("");
  return <FluentProvider theme={webLightTheme}><ResourceReferencesContext.Provider value={{ service, suggestions: [], open: async () => {}, capture: async () => token }}>
    <main style={{ width: "min(780px, 100%)", padding: 16, margin: "0 auto", boxSizing: "border-box" }}>
      <h1>证据比较</h1><p>已选片段与资料来源</p>
      <AssistantComposer input={draft.input} contextTokens={draft.tokens} contextScopeId="review:session" modeHint="提问" onInputChange={input => setDraft(previous => ({ ...previous, input, tokens: mapContextMentions(previous.input, input, previous.tokens) }))}
        onRemoveContextToken={id => setDraft(previous => ({ ...previous, tokens: previous.tokens.filter(value => value.id !== id) }))}
        onSend={() => setSent(draft.input)} onVoiceInput={() => {}} />
      <p role="status">{sent}</p>
    </main>
  </ResourceReferencesContext.Provider></FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider, Select, Textarea, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { QuickAskPresetPicker } from "../../../app/features/quick-ask-presets/QuickAskPresetPicker";
import { QuickAskPresetManager } from "../../../app/features/quick-ask-presets/QuickAskPresetManager";
import { useQuickAskPresets } from "../../../app/features/quick-ask-presets/useQuickAskPresets";
import { quickAskPrimaryAction, resolveQuickAskInstruction } from "../../../app/features/quick-ask-presets/quickAskPresets";
function Fixture() {
  const [scopeId, setScope] = useState("browser-preset-a");
  const [dark, setDark] = useState(false);
  const [custom, setCustom] = useState("");
  const [previousDraft, setPreviousDraft] = useState("");
  const model = useQuickAskPresets({ scopeId });
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme} style={{ minHeight: "100vh", padding: 8, boxSizing: "border-box", minWidth: 0 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}><Button onClick={() => setDark(value => !value)}>切换主题</Button>
      <Select aria-label="测试账号" value={scopeId} onChange={(_, data) => setScope(data.value)}><option value="browser-preset-a">账号 A</option><option value="browser-preset-b">账号 B</option></Select></div>
    <main style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <QuickAskPresetPicker presets={model.presets} selectedPresetId={model.selectedPreset.id} onSelect={model.selectPreset} customInstruction={custom}
        onUsePreset={() => { setPreviousDraft(custom); setCustom(""); }} />
      <Textarea aria-label="本次指令" value={custom} onChange={(_, data) => setCustom(data.value)} />
      {!!previousDraft && <Button onClick={() => setCustom(previousDraft)}>恢复自定义草稿</Button>}
      <Button data-testid="primary-task" onClick={() => void model.markCompleted(model.selectedPreset.id)}>{quickAskPrimaryAction(custom, model.selectedPreset)}</Button>
      <output aria-label="实际指令">{resolveQuickAskInstruction(custom, model.selectedPreset)}</output>
      {model.error && <div role="alert">{model.error}</div>}{model.fallbackNotice && <div role="status">{model.fallbackNotice}</div>}
      <QuickAskPresetManager repository={model.repository} initialInstruction={custom} />
    </main>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

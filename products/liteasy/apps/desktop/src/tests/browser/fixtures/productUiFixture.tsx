import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { ApplicationThemeProvider } from "../../../app/features/theme/ApplicationThemeProvider";
import { notifyAppearancePreference } from "../../../app/features/theme/appearancePreference";
import { ActionButton, ActionChips, ContextSummary, GenerationComposer, InlineNotice, ReadingSurface, ResponsiveOverlay, SourceDisclosure, SurfaceHeader, type OverlayAnchor } from "../../../app/shared/ui/productPrimitives";
import { ContentView } from "../../../app/features/markdown/ContentView";
import { legacyContent } from "../../../app/features/markdown/contentFragment";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";
function Gallery() {
  const [open, setOpen] = useState(false), [value, setValue] = useState(""), [task, setTask] = useState("explain"), [count, setCount] = useState(0), [side, setSide] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), primary = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<OverlayAnchor>({ getBoundingClientRect: () => new DOMRect(700, 100, 20, 20) });
  const launch = (x: number, y: number) => { setAnchor({ getBoundingClientRect: () => new DOMRect(x, y, 24, 24) }); setOpen(true); };
  return <ApplicationThemeProvider><main style={{ padding: 16 }}><SurfaceHeader title="产品原语 gallery（隔离演示）" /><div className="product-action-chips"><ActionButton onClick={() => notifyAppearancePreference("light")}>浅色</ActionButton><ActionButton onClick={() => notifyAppearancePreference("dark")}>深色</ActionButton><ActionButton onClick={() => notifyAppearancePreference("system")}>跟随系统</ActionButton></div>
    <p>所有示例不写资料库，不发送模型请求。</p><ActionButton ref={trigger} onClick={() => launch(window.innerWidth / 2, 100)}>打开原语浮层</ActionButton>
    {["左上", "右上", "左下", "右下"].map((label, i) => <ActionButton key={label} onClick={() => launch(i % 2 ? window.innerWidth - 28 : 4, i > 1 ? window.innerHeight - 28 : 4)}>{label}</ActionButton>)}
    <ActionButton disabled>不可用操作</ActionButton><InlineNotice intent="warning" message="合成摘要缺失，保留真实范围。" /><InlineNotice intent="error" message="保存失败；可以重试同一结果。" action={<ActionButton>重试保存</ActionButton>} /><InlineNotice intent="busy" message="正在准备资料…" />
    <ResponsiveOverlay open={open} onClose={() => setOpen(false)} title="速问原语样板" anchor={anchor} mode={side ? "side" : "auto"} returnFocusRef={trigger} initialFocusRef={primary} actions={<><ActionButton onClick={() => setSide(value => !value)}>固定到侧边</ActionButton><ActionButton ref={primary} appearance="primary" onClick={() => setCount(n => n + 1)}>解释选段</ActionButton></>}>
      <ContextSummary>第 2 页 · 离线合成选段</ContextSummary><blockquote className="quick-ask-excerpt">真实选段内容用于演示层级。{("长摘录保留原文，不伪造来源。 ").repeat(8)}</blockquote>
      <ActionChips value={task} onChange={setTask} items={[{ id: "explain", label: "解释选段" }, { id: "translate", label: "翻译" }, { id: "long", label: "Explain the selected passage with complete terminology" }, { id: "disabled", label: "不可用任务", disabled: true }]} />
      <GenerationComposer value={value} onChange={setValue} onSubmit={() => setCount(n => n + 1)} /><SourceDisclosure summary="选段 · 本页 · 摘要缺失"><p>来源已记录；未执行独立语义核验。</p></SourceDisclosure>
      <ReadingSurface label="合成回答"><ContentView content={legacyContent("## 可滚动的完整正文\n\n" + "段落含 **强调**、公式 $x^2$ 和 [来源](https://example.invalid)。\n\n".repeat(25))} /></ReadingSurface><InlineNotice message={`动作次数：${count}`} />
    </ResponsiveOverlay>
  </main></ApplicationThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<Gallery />);

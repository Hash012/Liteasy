import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, Input } from "@fluentui/react-components";
import { MoreHorizontalRegular } from "@fluentui/react-icons";
import { ApplicationThemeProvider } from "../../../app/features/theme/ApplicationThemeProvider";
import { notifyAppearancePreference } from "../../../app/features/theme/appearancePreference";
import { ActionButton, ContextualActions, IconAction, DisclosureSection, OptionPicker, InfoPopover, FilterPopover } from "../../../app/shared/ui/productPrimitives";
import { SurfaceErrorBoundary } from "../../../app/shared/ui/SurfaceErrorBoundary";
import { DockRegion } from "../../../app/features/dock/DockRegion";
import { ReadingLibraryCatalog } from "../../../app/features/library/ReadingLibraryCatalog";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";
function Crash({ failed }: { failed: boolean }) { if (failed) throw new TypeError("Synthetic render failure"); return <p>面板正常</p>; }
function Owner({ id, children }: { id: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="product-contextual-owner" data-testid={id} style={{ padding: 8, border: "1px solid var(--border-subtle)" }}>{id}<ContextualActions menuOpen={open}><Menu open={open} onOpenChange={(_, data) => setOpen(data.open)}><MenuTrigger disableButtonEnhancement><IconAction density="compact" label={`${id}操作`} icon={<MoreHorizontalRegular />} /></MenuTrigger><MenuPopover><MenuList><MenuItem>查看{id}</MenuItem></MenuList></MenuPopover></Menu></ContextualActions>{children}</div>;
}
function NestedDismissalOwner() {
  const [open, setOpen] = useState(true), [value, setValue] = useState("all");
  return <section aria-label="嵌套关闭测试" tabIndex={-1} onMouseDown={event => event.preventDefault()} onKeyDown={event => {
    if (event.key === "Escape" && !event.defaultPrevented) setOpen(false);
  }}>{open ? <><InfoPopover label="嵌套说明"><p>选区保留时也可关闭说明。</p></InfoPopover><FilterPopover label="嵌套筛选"><OptionPicker aria-label="嵌套类型" value={value} onValueChange={setValue} options={[{ value: "all", label: "全部" }, { value: "pdf", label: "PDF" }]} /></FilterPopover></> : <p>外层已关闭</p>}</section>;
}
function Fixture() {
  const [active, setActive] = useState("14"), [count, setCount] = useState(15), [value, setValue] = useState(""), [saved, setSaved] = useState(""), [failed, setFailed] = useState(false);
  return <ApplicationThemeProvider><main style={{ padding: 16 }}><ActionButton onClick={() => notifyAppearancePreference("light")}>浅色</ActionButton><ActionButton onClick={() => notifyAppearancePreference("dark")}>深色</ActionButton><OptionPicker aria-label="标签数量" value={String(count)} options={[2, 6, 15].map(n => ({ value: String(n), label: String(n) }))} onValueChange={n => { setCount(Number(n)); setActive(String(Number(n) - 1)); }} /><section data-testid="pane" style={{ width: "var(--test-pane-width, 420px)", height: 320, maxWidth: "100%" }}><DockRegion regionId="main" layout={{ itemIds: [], activeItemId: null }} dynamicTabs={Array.from({ length: count }, (_, n) => ({ id: String(n), title: n % 2 ? `English research document with long name ${n}` : `长中文论文标题 ${n}`, selected: active === String(n), onActivate: () => setActive(String(n)), onClose: () => {}, render: () => <Input aria-label={`文档草稿${n}`} defaultValue="保留草稿" /> }))} onActivateItem={() => {}} onCloseItem={() => {}} onMoveItem={() => {}} onSplitRegion={() => {}} renderItem={() => null} /></section>
  <section style={{ width: "var(--test-pane-width, 420px)", maxWidth: "100%" }}><Owner id="外层"><Owner id="内层一" /><Owner id="内层二" /></Owner>
  <form aria-label="真实值表单" onSubmit={event => { event.preventDefault(); setSaved(String(new FormData(event.currentTarget).get("status"))); }}><OptionPicker aria-label="状态" required name="status" value={value} onValueChange={setValue} options={[{ value: "", label: "请选择" }, { value: "active", label: "启用" }, { value: "disabled", label: "禁用", description: "保持资料，只关闭操作" }]} /><ActionButton type="submit">保存选项</ActionButton><output>{saved}</output></form>
  <DisclosureSection title="章节设置"><Input aria-label="章节草稿" defaultValue="草稿" /></DisclosureSection><InfoPopover label="关于控件"><p>完整说明与帮助，不占额外折叠行。</p></InfoPopover><ActionButton onClick={() => setFailed(!failed)}>注入异常</ActionButton><SurfaceErrorBoundary surface="fixture"><Crash failed={failed} /></SurfaceErrorBoundary></section>
  <section style={{ width: "var(--test-pane-width, 420px)", height: 450, maxWidth: "100%" }}><ReadingLibraryCatalog entries={[{ id: "one", title: "合成论文", format: "pdf", readingStatus: "unread", authors: ["Synthetic"], year: 2026, liteasyPath: "liteasy://fixture/one" }, { id: "two", title: "合成电子书", format: "epub", readingStatus: "reading", authors: ["Synthetic"], year: 2025, liteasyPath: "liteasy://fixture/two" }]} onOpen={() => {}} /></section>
  <NestedDismissalOwner /></main></ApplicationThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

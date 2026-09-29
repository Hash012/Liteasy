import { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner, Tab, TabList, Tooltip } from "@fluentui/react-components";
import { AppsRegular, DismissRegular, DocumentRegular, HistoryRegular } from "@fluentui/react-icons";
import { movePageSelection, type WorkspacePageOption } from "./pageHistory";
import "./workspacePageSwitcher.css";

export function WorkspacePageSwitcher({ mode, options, currentKey, onModeChange, onSelect, onClose, pending, error }: {
  mode: "history" | "active";
  options: WorkspacePageOption[];
  currentKey?: string;
  onModeChange(mode: "history" | "active"): void;
  onSelect(option: WorkspacePageOption): void;
  onClose(): void;
  pending: boolean;
  error: string;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const initialKey = mode === "history" ? options.find((item) => item.key !== currentKey && item.available)?.key ?? options[0]?.key
    : options.find((item) => item.key === currentKey)?.key ?? options[0]?.key;
  const selected = options.findIndex((item) => item.key === selectedKey);
  const keys = JSON.stringify(options.map((item) => item.key));
  const lastMode = useRef<string>();
  useEffect(() => {
    const next = lastMode.current !== mode || selected < 0 ? initialKey : selectedKey;
    lastMode.current = mode;
    setSelectedKey(next ?? "");
    const index = options.findIndex((item) => item.key === next);
    const frame = requestAnimationFrame(() => grid.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[index]?.focus());
    return () => cancelAnimationFrame(frame);
  }, [mode, keys]);
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !pending) onClose(); }}>
    <DialogSurface aria-label="页面切换" className="workspace-page-switcher"><DialogBody>
      <DialogTitle action={<Tooltip content="关闭 · Esc" relationship="description"><Button appearance="subtle" aria-label="关闭页面切换" icon={<DismissRegular />} disabled={pending} onClick={onClose} /></Tooltip>}>页面切换</DialogTitle>
      <DialogContent>
        <TabList aria-label="页面范围" selectedValue={mode} onTabSelect={(_, data) => { if (!pending) onModeChange(data.value as "history" | "active"); }}>
          <Tab value="history" icon={<HistoryRegular />}>历史页面 <kbd>Ctrl+H</kbd></Tab>
          <Tab value="active" icon={<AppsRegular />}>活跃页面 <kbd>Ctrl+T</kbd></Tab>
        </TabList>
        <p className="page-switcher-description">{mode === "history" ? "最近访问在前，按行排列。" : "当前已打开的页面，包含收起栏中的页面。"}</p>
        <div ref={grid} role="listbox" aria-label={mode === "history" ? "历史页面" : "活跃页面"} className="page-switcher-grid"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || pending) return;
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const cards = [...grid.current!.querySelectorAll<HTMLButtonElement>('[role="option"]')];
            const firstTop = cards[0]?.offsetTop;
            const columns = cards.filter((card) => card.offsetTop === firstTop).length || 1;
            const next = movePageSelection(Math.max(0, selected), event.key, options.length, columns);
            cards[next]?.focus(); cards[next]?.scrollIntoView({ block: "nearest" });
          }}>
          {options.map((item, index) => <button key={item.key} role="option" type="button" className="page-switcher-card"
            aria-label={`${item.title} · ${item.type}`} aria-selected={item.key === selectedKey} aria-disabled={!item.available || pending}
            tabIndex={item.key === selectedKey || (!selectedKey && index === 0) ? 0 : -1}
            onFocus={() => setSelectedKey(item.key)} onClick={() => { if (item.available && !pending) onSelect(item); }}>
            <span className="page-switcher-card-top"><DocumentRegular aria-hidden="true" /><span>{item.type}</span>{item.key === currentKey ? <small>当前</small> : null}</span>
            <strong title={item.title}>{item.title}</strong>
            <span className="page-switcher-card-meta">{item.open ? ({ main: "中间栏", left: "左栏", right: "右栏", bottom: "下栏" }[item.region] ?? "分栏") : item.available ? "已关闭 · 可重新打开" : "已关闭 · 从来源重新打开"}</span>
            {mode === "history" && item.visitedAt ? <time dateTime={new Date(item.visitedAt).toISOString()}>{new Date(item.visitedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time> : null}
          </button>)}
        </div>
        {!options.length ? <p className="page-switcher-empty" role="status">{mode === "history" ? "还没有访问记录，打开文献或工作区页面后会显示在这里。" : "当前没有打开的页面。"}</p> : null}
        {error ? <p role="alert" className="page-switcher-error">{error}</p> : null}
        {pending ? <Spinner size="tiny" label="正在打开页面" /> : null}
        <footer className="page-switcher-footer"><span>{options.length} 个页面</span><span>← ↑ ↓ → 选择 · Enter 打开 · Esc 退出</span></footer>
      </DialogContent>
    </DialogBody></DialogSurface>
  </Dialog>;
}

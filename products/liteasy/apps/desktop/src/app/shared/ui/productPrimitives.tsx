import { forwardRef, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Popover, PopoverSurface, Spinner, Textarea, Tooltip, type ButtonProps } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import "./productPrimitives.css";

export const ActionButton = forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => <Button {...props} ref={ref} className={`product-action ${props.className ?? ""}`} />);
ActionButton.displayName = "ActionButton";
export function IconAction({ label, ...props }: ButtonProps & { label: string }) { return <Tooltip content={label} relationship="description"><Button {...props} className={`product-icon-action ${props.className ?? ""}`} aria-label={label} /></Tooltip>; }
export function SurfaceHeader({ title, children, onClose }: { title: string; children?: ReactNode; onClose?: () => void }) {
  return <header className="product-surface-header"><h2>{title}</h2>{children}{onClose ? <IconAction label="关闭" appearance="subtle" icon={<DismissRegular />} onClick={onClose} /> : null}</header>;
}
export function SurfaceActions({ children }: { children: ReactNode }) { return <footer className="product-surface-actions">{children}</footer>; }
export function ActionChips({ items, value, onChange, label = "选择任务" }: { items: readonly { id: string; label: string; disabled?: boolean }[]; value: string; onChange(id: string): void; label?: string }) {
  return <div className="product-action-chips" role="group" aria-label={label}>{items.map(item => <ActionButton key={item.id} appearance={value === item.id ? "primary" : "secondary"} aria-pressed={value === item.id} disabled={item.disabled} onClick={() => onChange(item.id)}>{item.label}</ActionButton>)}</div>;
}
export function GenerationComposer({ value, onChange, label = "补充指令（可选）", placeholder = "可直接开始，也可补充你的要求", disabled = false, onSubmit }: { value: string; onChange(value: string): void; label?: string; placeholder?: string; disabled?: boolean; onSubmit?: () => void }) {
  return <Textarea className="product-generation-composer" aria-label={label} rows={2} resize="vertical" value={value} placeholder={placeholder} disabled={disabled} onKeyDown={event => { if (onSubmit && !disabled && !event.nativeEvent.isComposing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onSubmit(); } }} onChange={(_, data) => onChange(data.value)} />;
}
export function ContextSummary({ children }: { children: ReactNode }) { return <div className="product-context-summary">{children}</div>; }
export function SourceDisclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) { return <details className="product-source-disclosure"><summary>{summary}</summary><div>{children}</div></details>; }
export function InlineNotice({ intent = "info", message, action }: { intent?: "info" | "warning" | "error" | "success" | "busy"; message: string; action?: ReactNode }) {
  return <div className="product-inline-notice" data-intent={intent} role={intent === "error" ? "alert" : "status"}>{intent === "busy" ? <Spinner size="tiny" /> : null}<span>{message}</span>{action}</div>;
}
export function ReadingSurface({ children, label }: { children: ReactNode; label?: string }) { return <section className="product-reading-surface" aria-label={label}>{children}</section>; }

export type OverlayAnchor = { getBoundingClientRect(): DOMRect };
export type ResponsiveOverlayProps = {
  open: boolean; onClose(): void; title: string; children: ReactNode; actions?: ReactNode;
  anchor?: OverlayAnchor; availableWidth?: number; boundary?: HTMLElement | null;
  initialFocusRef?: RefObject<HTMLElement | null>; mode?: "auto" | "side"; returnFocusRef?: RefObject<HTMLElement | null>;
};
/** One positioning/focus boundary for reading surfaces. It owns no generation or storage. */
export function ResponsiveOverlay({ open, onClose, title, children, actions, anchor, availableWidth, boundary, mode = "auto", returnFocusRef, initialFocusRef }: ResponsiveOverlayProps) {
  const id = useId();
  const [viewport, setViewport] = useState(() => ({ width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight }));
  const [boundaryWidth, setBoundaryWidth] = useState<number>();
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const measure = () => { setViewport({ width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight }); setBoundaryWidth(boundary?.getBoundingClientRect().width); };
    measure(); window.addEventListener("resize", measure); window.visualViewport?.addEventListener("resize", measure);
    const observer = boundary ? new ResizeObserver(measure) : undefined; if (boundary) observer?.observe(boundary);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("resize", measure); };
  }, [boundary]);
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { const target = returnFocusRef?.current ?? previousFocus.current; if (target?.isConnected) target.focus({ preventScroll: true }); };
  }, [open, returnFocusRef]);
  const width = Math.min(viewport.width, availableWidth ?? boundaryWidth ?? viewport.width);
  const sheet = width < 560 || viewport.height < 420;
  useEffect(() => {
    if (!open || !initialFocusRef) return;
    const frame = requestAnimationFrame(() => initialFocusRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, sheet, initialFocusRef]);
  const sideAnchor = useMemo<OverlayAnchor>(() => ({ getBoundingClientRect: () => new DOMRect(viewport.width - 12, 12, 0, Math.max(0, viewport.height - 24)) }), [viewport]);
  if (sheet) return <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) onClose(); }}><DialogSurface className="product-overlay-sheet" aria-labelledby={id}><DialogBody className="product-overlay-body"><DialogTitle id={id} action={<IconAction label="关闭" appearance="subtle" icon={<DismissRegular />} onClick={onClose} />}>{title}</DialogTitle><DialogContent className="product-overlay-content">{children}</DialogContent>{actions ? <DialogActions className="product-overlay-actions">{actions}</DialogActions> : null}</DialogBody></DialogSurface></Dialog>;
  return <Popover open={open} trapFocus={false} onOpenChange={(_, data) => { if (!data.open) onClose(); }} positioning={{ target: mode === "side" ? sideAnchor : anchor ?? sideAnchor, position: "before", align: "top", offset: 12, overflowBoundaryPadding: 12, flipBoundary: boundary ?? undefined, overflowBoundary: boundary ?? undefined, autoSize: "always", fallbackPositions: ["after-top", "below-start", "above-start"] }}><PopoverSurface role="dialog" aria-modal={false} className="product-overlay-popover" aria-label={title} data-layout={mode}><SurfaceHeader title={title} onClose={onClose} /><div className="product-overlay-content">{children}</div>{actions ? <SurfaceActions>{actions}</SurfaceActions> : null}</PopoverSurface></Popover>;
}

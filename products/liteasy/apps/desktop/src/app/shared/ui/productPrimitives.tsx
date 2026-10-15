import { createContext, useContext, forwardRef, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject, type ButtonHTMLAttributes, type KeyboardEvent } from "react";
import { Accordion, AccordionItem, AccordionHeader, AccordionPanel, Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Option, Popover, PopoverTrigger, PopoverSurface, Spinner, Textarea, Tooltip, type ButtonProps } from "@fluentui/react-components";
import { DismissRegular, FilterRegular, InfoRegular, TextBulletListLtrRegular } from "@fluentui/react-icons";
import "./productPrimitives.css";

export type ControlDensity = "compact" | "default";
const ControlDensityContext = createContext<ControlDensity>("default");
export function ControlToolbar({ children, density = "compact", className = "", label, role = "group" }: { children: ReactNode; density?: ControlDensity; className?: string; label: string; role?: "group" | "search" }) {
  return <ControlDensityContext.Provider value={density}><div role={role} aria-label={label} data-density={density} className={`product-control-toolbar ${className}`}>{children}</div></ControlDensityContext.Provider>;
}
export const ActionButton = forwardRef<HTMLButtonElement, ButtonProps & { density?: ControlDensity }>(({ density, ...props }, ref) => { const inherited = useContext(ControlDensityContext); return <Button {...props} ref={ref} data-density={density ?? inherited} className={`product-action ${props.className ?? ""}`} />; });
ActionButton.displayName = "ActionButton";
export const IconAction = forwardRef<HTMLButtonElement, ButtonProps & { label: string; description?: string; density?: ControlDensity }>(({ label, description, density, ...props }, ref) => { const inherited = useContext(ControlDensityContext); return <Tooltip content={description ?? label} relationship="description"><Button {...props} ref={ref} data-density={density ?? inherited} className={`product-icon-action ${props.className ?? ""}`} aria-label={label} /></Tooltip>; });
IconAction.displayName = "IconAction";
/** Place inside a product-contextual-owner. The slot keeps its space and keyboard entry. */
export function ContextualActions({ children, selected = false, expanded = false, menuOpen = false, editing = false, label = "条目操作", className = "" }: { children: ReactNode; selected?: boolean; expanded?: boolean; menuOpen?: boolean; editing?: boolean; label?: string; className?: string }) {
  return <span role="group" aria-label={label} className={`product-contextual-actions ${className}`} data-revealed={selected || expanded || menuOpen || editing}>{children}</span>;
}
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
/** Sections preserve their children while collapsed so drafts and task effects survive. */
export function DisclosureSection({ title, children, icon = <TextBulletListLtrRegular />, open, defaultOpen = false, onOpenChange, headerButton, className = "" }: { title: ReactNode; children: ReactNode; icon?: ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; headerButton?: Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "aria-label">; className?: string }) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const shown = open ?? expanded;
  const id = useId();
  return <Accordion collapsible className={`product-disclosure-section ${className}`} openItems={shown ? [id] : []} onToggle={(_, data) => { const next = data.openItems.includes(id); setExpanded(next); onOpenChange?.(next); }}><AccordionItem value={id}><AccordionHeader expandIconPosition="end" icon={icon ? { children: icon } : undefined} button={{ ...headerButton, "aria-controls": `${id}-panel` }}>{title}</AccordionHeader><div id={`${id}-panel`} hidden={!shown}><AccordionPanel collapseMotion={{ children: (Motion, props) => <Motion {...props} unmountOnExit={false} /> }}>{children}</AccordionPanel></div></AccordionItem></Accordion>;
}
/** Compatibility for existing semantic source sections; callers choose their actual use. */
export function SourceDisclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) { return <DisclosureSection title={summary}>{children}</DisclosureSection>; }
function useLocalPopover() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  function escape(event: KeyboardEvent<HTMLElement>) {
    if (!open || event.key !== "Escape") return;
    // A child picker consumes its first Escape; keep that event inside this layer.
    event.stopPropagation();
    if (event.defaultPrevented) return;
    event.preventDefault(); setOpen(false); trigger.current?.focus({ preventScroll: true });
  }
  function changeOpen(next: boolean, escapeKey: boolean) {
    setOpen(next);
    // Reading selection tools suppress mousedown focus to preserve the excerpt.
    // Explicit focus gives a text-only popover a local keyboard dismissal target.
    if (next || escapeKey) trigger.current?.focus({ preventScroll: true });
  }
  return { open, trigger, escape, changeOpen };
}
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const local = useLocalPopover();
  return <Popover open={local.open} onOpenChange={(event, data) => local.changeOpen(data.open, "key" in event && event.key === "Escape")} positioning={{ position: "below", align: "start", autoSize: "always" }}><PopoverTrigger disableButtonEnhancement><IconAction ref={local.trigger} onKeyDown={local.escape} label={label} density="compact" appearance="subtle" icon={<InfoRegular />} /></PopoverTrigger><PopoverSurface className="product-info-popover" aria-label={label} onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}><div style={{ display: "contents" }} onKeyDown={local.escape}>{children}</div></PopoverSurface></Popover>;
}
export function FilterPopover({ label = "筛选", activeCount = 0, children }: { label?: string; activeCount?: number; children: ReactNode }) {
  const local = useLocalPopover();
  return <Popover open={local.open} onOpenChange={(event, data) => local.changeOpen(data.open, "key" in event && event.key === "Escape")} positioning={{ position: "below", align: "end", autoSize: "always" }}><PopoverTrigger disableButtonEnhancement><ActionButton ref={local.trigger} onKeyDown={local.escape} density="compact" appearance={activeCount ? "primary" : "subtle"} icon={<FilterRegular />} aria-label={label}>{label}{activeCount > 0 ? ` (${activeCount})` : ""}</ActionButton></PopoverTrigger><PopoverSurface className="product-filter-popover" aria-label={label} onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}><div style={{ display: "contents" }} onKeyDown={local.escape}>{children}</div></PopoverSurface></Popover>;
}
export type PickerOption = { value: string; label: string; description?: string; icon?: ReactNode; disabled?: boolean };
/** A label snapshot is valid only for the same identity and permission scope.
 * The picker never caches labels across changes of account, organization or value. */
export type PickerSelectedDisplay = { value: string; scopeKey: string } & (
  | { state: "ready"; label: string }
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "unnamed"; label?: string }
  | { state: "error"; onRetry?: () => void }
);
export type OptionPickerProps = { scopeKey?: string; selectedDisplay?: PickerSelectedDisplay; value: string; onValueChange(value: string): void; options: readonly PickerOption[]; "aria-label"?: string; "aria-labelledby"?: string; "aria-describedby"?: string; id?: string; name?: string; form?: string; required?: boolean; disabled?: boolean; className?: string; density?: ControlDensity; placeholder?: string; autoFocus?: boolean; title?: string; onBlur?: () => void };
/** Business values never depend on translated labels or Dropdown's event target. */
export function OptionPicker({ scopeKey, selectedDisplay, value, onValueChange, options, "aria-label": label, "aria-labelledby": labelledBy, "aria-describedby": describedBy, id, name, form, required, disabled, className = "", density, placeholder = "请选择", autoFocus, title, onBlur }: OptionPickerProps) {
  const inheritedDensity = useContext(ControlDensityContext);
  density ??= inheritedDensity;
  const trigger = useRef<HTMLButtonElement>(null);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  useEffect(() => { if (value) setInvalid(false); }, [value]);
  const selected = options.find(option => option.value === value);
  const display = selectedDisplay?.value === value && selectedDisplay.scopeKey === scopeKey ? selectedDisplay : undefined;
  const displayState = !value ? "empty" : display?.state ?? (selected ? "ready" : "loading");
  const displayLabel = !value ? selected?.label ?? "" : display
    ? display.state === "ready" ? display.label
      : display.state === "unnamed" ? display.label ?? "未命名项目"
      : display.state === "error" ? "名称加载失败"
      : display.state === "unavailable" ? "所选项已不可用，请重新选择" : "正在加载所选项…"
    : selected?.label ?? "正在加载所选项…";
  return <span className={`product-option-picker-field ${className}`} data-density={density} data-selection-state={displayState}><Dropdown id={id} title={title} button={{ ref: trigger, autoFocus }} className="product-option-picker" data-density={density} aria-label={label} aria-labelledby={labelledBy} aria-describedby={[describedBy, invalid ? errorId : undefined].filter(Boolean).join(" ") || undefined} aria-required={required} aria-invalid={invalid || undefined} disabled={disabled} value={displayLabel} selectedOptions={value ? [value] : []} placeholder={placeholder} onBlur={onBlur} onOptionSelect={(_, data) => { if (data.optionValue !== undefined) { setInvalid(Boolean(required && !data.optionValue)); onValueChange(data.optionValue); } }} listbox={{ className: "product-option-listbox" }}>
    {options.map(option => <Option key={option.value} value={option.value} data-option-value={option.value} text={option.label} disabled={option.disabled}>{option.icon}<span className="product-option-text">{option.label}{option.description ? <small>{option.description}</small> : null}</span></Option>)}
  </Dropdown>{value && display?.state === "error" && display.onRetry ? <ActionButton appearance="subtle" onClick={display.onRetry}>重试加载名称</ActionButton> : null}{name ? <input type="hidden" name={name} form={form} value={value} disabled={disabled} /> : null}{required ? <input className="product-validation-proxy" tabIndex={-1} aria-label={label ? `${label}验证` : "选项验证"} value={value} onChange={() => {}} required disabled={disabled} form={form} onInvalid={event => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }} /> : null}{invalid ? <span id={errorId} role="alert" className="product-field-error">请选择一个选项。</span> : null}</span>;
}
export function InlineNotice({ intent = "info", message, action }: { intent?: "normal" | "info" | "warning" | "error" | "success" | "busy"; message: string; action?: ReactNode }) {
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

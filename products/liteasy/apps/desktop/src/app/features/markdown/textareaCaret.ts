/** A short-lived, non-interactive mirror gives a textarea caret a popover anchor. */
export function textareaCaret(element: HTMLTextAreaElement, offset: number): DOMRect {
  const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
  const mirror = document.createElement("div");
  Object.assign(mirror.style, { position: "fixed", visibility: "hidden", pointerEvents: "none", whiteSpace: "pre-wrap", overflowWrap: "break-word", boxSizing: "border-box", width: `${element.clientWidth}px` });
  for (const key of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "tabSize"] as const) mirror.style[key] = style[key];
  mirror.textContent = element.value.slice(0, offset);
  const caret = document.createElement("span"); caret.textContent = "\u200b"; mirror.append(caret);
  document.body.append(mirror);
  const rect = new DOMRect(bounds.left + caret.offsetLeft - element.scrollLeft, bounds.top + caret.offsetTop - element.scrollTop, 1, parseFloat(style.lineHeight) || 24);
  mirror.remove();
  return rect;
}

const eventName = "liteasy-mobile-library-changed";
export function notifyLibraryChanged(scope: string) { window.dispatchEvent(new CustomEvent(eventName, { detail: { scope } })); }
export function subscribeLibraryChanged(scope: string, listener: () => void) {
  const handler = (event: Event) => { if ((event as CustomEvent<{ scope: string }>).detail.scope === scope) listener(); };
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}

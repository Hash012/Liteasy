import { useLayoutEffect, useRef } from "react";

/** Keep an ongoing surface mounted while its tab moves between containers. */
export function createDockSurfaceHost() {
  const host = document.createElement("div");
  host.className = "dock-persistent-surface";
  return host;
}

export function DockSurfaceSlot({ host }: { host: HTMLElement }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = slot.current!;
    element.appendChild(host);
    return () => {
      if (host.parentNode === element) element.removeChild(host);
    };
  }, [host]);
  return <div className="dock-surface-slot" ref={slot} />;
}

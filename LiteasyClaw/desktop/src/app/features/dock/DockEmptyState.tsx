import liteasyLogoUrl from "../../../assets/liteasyclaw-logo.jpg";

export function DockEmptyState() {
  return (
    <div aria-label="空 Dock 区域" className="dock-empty-state">
      <img alt="LiteasyClaw" src={liteasyLogoUrl} />
    </div>
  );
}

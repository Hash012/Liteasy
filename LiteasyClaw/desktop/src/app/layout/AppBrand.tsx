import liteasyClawLogo from "../../assets/liteasyclaw-logo.jpg";
export function AppBrand() {
  return (
    <div className="brand">
      <img alt="LiteasyClaw Logo" className="brand-logo" src={liteasyClawLogo} />
      <div className="brand-meta">
        <div className="brand-name">LiteasyClaw</div>
        <div className="brand-tagline">AI-driven paper-assisted reading platform</div>
      </div>
      <div className="model-mini-indicator">
        云端模型能力
      </div>
    </div>
  );
}

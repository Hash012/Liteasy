import type { SettingsState } from "../settings/settings.types";

type DevCloudEndpointPanelProps = {
  onUseLocalDevCloudDefaults: () => void;
  settings: SettingsState;
};

export function DevCloudEndpointPanel({
  onUseLocalDevCloudDefaults,
  settings
}: DevCloudEndpointPanelProps) {
  return (
    <div className="model-policy-card dev-cloud-endpoint-card">
      <div className="model-policy-title">开发云端点诊断</div>
      <div className="model-policy-meta">云代理端点：{settings["models.cloud_proxy_endpoint"]}</div>
      <div className="model-policy-meta">控制平面端点：{settings["models.control_plane_endpoint"]}</div>
      <button className="policy-button sync" onClick={onUseLocalDevCloudDefaults} type="button">
        使用本地开发云端点
      </button>
      <div className="model-policy-footnote">
        本地验收通常使用 http://127.0.0.1:8787；http://127.0.0.1:1420 是前端页面，不是开发云 API。
      </div>
    </div>
  );
}

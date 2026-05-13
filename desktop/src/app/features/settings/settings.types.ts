export type SettingKey =
  | "network.recommendation.enabled"
  | "network.recommendation.sort_mode"
  | "profile.enabled"
  | "assistant.default_output_mode"
  | "assistant.language"
  | "models.access_mode"
  | "models.local_direct_enabled"
  | "models.default_provider"
  | "models.cloud_proxy_endpoint"
  | "models.local_direct_endpoint"
  | "models.control_plane_endpoint";

export type SettingsState = {
  "network.recommendation.enabled": boolean;
  "network.recommendation.sort_mode": "relevance" | "retrieved_at";
  "profile.enabled": boolean;
  "assistant.default_output_mode": string;
  "assistant.language": string;
  "models.access_mode": "cloud_proxy" | "local_direct";
  "models.local_direct_enabled": boolean;
  "models.default_provider": string;
  "models.cloud_proxy_endpoint": string;
  "models.local_direct_endpoint": string;
  "models.control_plane_endpoint": string;
};

export type UpdateSettingCommand = {
  intent: "update_setting";
  target: SettingKey;
  value: boolean | string;
};

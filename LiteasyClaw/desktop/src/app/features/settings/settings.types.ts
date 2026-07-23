export type SettingKey =
  | "network.recommendation.enabled"
  | "network.recommendation.sort_mode"
  | "assistant.default_output_mode"
  | "assistant.language"
  | "models.default_provider"
  | "models.cloud_proxy_endpoint"
  | "models.control_plane_endpoint";

export type SettingsState = {
  "network.recommendation.enabled": boolean;
  "network.recommendation.sort_mode": "relevance" | "retrieved_at";
  "assistant.default_output_mode": string;
  "assistant.language": string;
  "models.default_provider": string;
  "models.cloud_proxy_endpoint": string;
  "models.control_plane_endpoint": string;
};

export type UpdateSettingCommand = {
  intent: "update_setting";
  target: SettingKey;
  value: boolean | string;
};

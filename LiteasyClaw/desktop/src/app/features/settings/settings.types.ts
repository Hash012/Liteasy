export type SettingKey =
  | "network.recommendation.enabled"
  | "network.recommendation.sort_mode"
  | "assistant.public_audit.enabled"
  | "profile.enabled"
  | "assistant.default_output_mode"
  | "assistant.language"
  | "import.ocr_language"
  | "thin_reading.intuecho_endpoint"
  | "thin_reading.openalex_api_key"
  | "models.default_provider"
  | "models.cloud_proxy_endpoint"
  | "models.control_plane_endpoint";

export type SettingsState = {
  "network.recommendation.enabled": boolean;
  "network.recommendation.sort_mode": "relevance" | "retrieved_at";
  "assistant.public_audit.enabled": boolean;
  "profile.enabled": boolean;
  "assistant.default_output_mode": string;
  "assistant.language": string;
  "import.ocr_language": "chi_sim" | "eng" | "eng+chi_sim";
  "thin_reading.intuecho_endpoint": string;
  "thin_reading.openalex_api_key": string;
  "models.default_provider": string;
  "models.cloud_proxy_endpoint": string;
  "models.control_plane_endpoint": string;
};

export type UpdateSettingCommand = {
  intent: "update_setting";
  target: SettingKey;
  value: boolean | string;
};

export type SettingKey =
  | "network.recommendation.enabled"
  | "network.recommendation.sort_mode"
  | "assistant.public_audit.enabled"
  | "profile.enabled"
  | "assistant.default_output_mode"
  | "assistant.language"
  | "import.ocr_language"
  | "privacy.cloud_pdf_parsing.enabled"
  | "thin_reading.intuecho_endpoint"
  | "models.default_provider"
  | "models.cloud_proxy_endpoint"
  | "models.control_plane_endpoint"
  | "view.font_family"
  | "view.font_size"
  | "view.pdf_background"
  | "view.pdf_custom_background";

export type SettingsState = {
  "network.recommendation.enabled": boolean;
  "network.recommendation.sort_mode": "relevance" | "retrieved_at";
  "assistant.public_audit.enabled": boolean;
  "profile.enabled": boolean;
  "assistant.default_output_mode": string;
  "assistant.language": string;
  "import.ocr_language": "chi_sim" | "eng" | "eng+chi_sim";
  "privacy.cloud_pdf_parsing.enabled": boolean;
  "thin_reading.intuecho_endpoint": string;
  "models.default_provider": string;
  "models.cloud_proxy_endpoint": string;
  "models.control_plane_endpoint": string;
  "view.font_family": string;
  "view.font_size": string;
  "view.pdf_background": "paper" | "warm" | "mint" | "custom";
  "view.pdf_custom_background": string;
};

export type UpdateSettingCommand = {
  intent: "update_setting";
  target: SettingKey;
  value: boolean | string;
};

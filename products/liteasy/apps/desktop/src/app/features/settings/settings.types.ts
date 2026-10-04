import type { RecommendationStyle } from "../recommendations/recommendation.types";
import type { AppearancePreference } from "../theme/appearancePreference";

import type { GenerationPromptSettingKey } from "../ai-prompts/generationPrompts";
import type { SelectionLookupSettingKey, SelectionLookupSettings } from "../selection-lookup/selectionLookup.types";

export type SettingKey =
  | GenerationPromptSettingKey
  | SelectionLookupSettingKey
  | "thin_reading.mode"
  | "papers.metadata_provider"
  | "papers.metadata_endpoint"
  | "papers.mineru_mode"
  | "papers.mineru_endpoint"
  | "network.recommendation.enabled"
  | "network.recommendation.sort_mode"
  | "network.recommendation.style"
  | "assistant.public_audit.enabled"
  | "profile.local_enabled"
  | "papers.local_mode"
  | "profile.enabled"
  | "assistant.default_output_mode"
  | "assistant.language"
  | "assistant.context_window"
  | "import.ocr_language"
  | "thin_reading.intuecho_endpoint"
  | "models.default_provider"
  | "models.connection_mode"
  | "models.direct_provider"
  | "models.direct_endpoint"
  | "models.direct_model"
  | "models.direct_protocol"
  | "models.direct_output_format"
  | "models.cloud_proxy_endpoint"
  | "models.control_plane_endpoint"
  | "view.font_family"
  | "view.reader_font_family"
  | "view.font_family_zh"
  | "view.font_family_en"
  | "view.reader_font_family_zh"
  | "view.reader_font_family_en"
  | "view.close_empty_panels"
  | "view.markdown_mode"
  | "view.markdown_autosave"
  | "view.list_density"
  | "view.theme"
  | "view.font_size"
  | "view.display_scale"
  | "view.pdf_preserve_images"
  | "view.pdf_background"
  | "view.pdf_custom_background";

export type SettingsState = Partial<Record<GenerationPromptSettingKey, string>> & Partial<SelectionLookupSettings> & {
  "thin_reading.mode": "fast" | "rigorous";
  "papers.metadata_provider": "crossref" | "openalex" | "semantic-scholar" | "cloud";
  "papers.metadata_endpoint": string;
  "papers.mineru_mode": "local" | "official" | "custom";
  "papers.mineru_endpoint": string;
  "network.recommendation.enabled": boolean;
  "network.recommendation.sort_mode": "relevance" | "retrieved_at";
  "network.recommendation.style": RecommendationStyle;
  "assistant.public_audit.enabled": boolean;
  "profile.local_enabled": boolean;
  "papers.local_mode": boolean;
  "profile.enabled": boolean;
  "assistant.default_output_mode": string;
  "assistant.language": string;
  "assistant.context_window"?: string;
  "import.ocr_language": "chi_sim" | "eng" | "eng+chi_sim";
  "thin_reading.intuecho_endpoint": string;
  "models.default_provider": string;
  "models.connection_mode": "cloud" | "direct";
  "models.direct_provider": string;
  "models.direct_endpoint": string;
  "models.direct_model": string;
  "models.direct_protocol": "openai" | "anthropic";
  "models.direct_output_format": "json_schema" | "json_object" | "prompt";
  "models.cloud_proxy_endpoint": string;
  "models.control_plane_endpoint": string;
  "view.font_family": string;
  "view.reader_font_family": string;
  "view.font_family_zh"?: string;
  "view.font_family_en"?: string;
  "view.reader_font_family_zh"?: string;
  "view.reader_font_family_en"?: string;
  "view.close_empty_panels"?: boolean;
  "view.markdown_mode"?: "live" | "manual";
  "view.markdown_autosave"?: boolean;
  "view.list_density"?: "comfortable" | "compact";
  "view.theme": AppearancePreference;
  "view.font_size": string;
  "view.display_scale": string;
  "view.pdf_background": "paper" | "warm" | "mint" | "night" | "custom";
  "view.pdf_custom_background": string;
  "view.pdf_preserve_images": boolean;
};

export type UpdateSettingCommand = {
  intent: "update_setting";
  target: SettingKey;
  value: boolean | string;
};

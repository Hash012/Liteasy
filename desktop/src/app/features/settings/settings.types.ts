export type SettingKey =
  | "network.recommendation.enabled"
  | "profile.enabled"
  | "assistant.default_output_mode"
  | "assistant.language";

export type SettingDefinition = {
  key: SettingKey;
  label: string;
  description: string;
  type: "boolean" | "string";
  defaultValue: boolean | string;
};

export type SettingChange = {
  intent: "update_setting";
  target: SettingKey;
  value: boolean | string;
};

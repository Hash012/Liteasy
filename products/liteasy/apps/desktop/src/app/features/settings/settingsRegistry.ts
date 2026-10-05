import { message } from "../../shared/i18n/i18n";
import { generationPromptKey, generationPromptTasks } from "../ai-prompts/generationPrompts";
import type { SettingKey } from "./settings.types";

export const settingsRegistry: Record<SettingKey, { label: string; help?: string; dependencies?: string[]; restartRequirement?: "none" | "next-run" }> = {
  ...Object.fromEntries(Object.entries(generationPromptTasks).map(([task, item]) => [generationPromptKey(task as keyof typeof generationPromptTasks), { get label() { return message("settings.prompts.label", { task: item.label }); }, get help() { return message("settings.help.prompts"); } }])) as Record<import("../ai-prompts/generationPrompts").GenerationPromptSettingKey, { label: string; help: string }>,
  "view.language": { get label() { return message("ui.language.label"); }, get help() { return message("ui.language.description"); }, dependencies: [], restartRequirement: "none" },
  "thin_reading.mode": { get label() { return message("settings.label.thin_reading.mode"); } },
  "lookup.dictionary_service": { get label() { return message("settings.label.lookup.dictionary_service"); }, get help() { return message("settings.help.dictionary"); } },
  "lookup.translation_service": { get label() { return message("settings.label.lookup.translation_service"); }, get help() { return message("settings.help.translation"); } },
  "lookup.source_language": { get label() { return message("settings.label.lookup.source_language"); } },
  "lookup.target_language": { get label() { return message("settings.label.lookup.target_language"); } },
  "lookup.auto_query": { get label() { return message("settings.label.lookup.auto_query"); }, get help() { return message("settings.help.autoLookup"); } },
  "lookup.libretranslate_endpoint": { get label() { return message("settings.label.lookup.libretranslate_endpoint"); } },
  "papers.metadata_provider": { get label() { return message("settings.label.papers.metadata_provider"); } },
  "papers.metadata_endpoint": { get label() { return message("settings.label.papers.metadata_endpoint"); } },
  "papers.mineru_mode": { get label() { return message("settings.label.papers.mineru_mode"); } },
  "papers.mineru_endpoint": { get label() { return message("settings.label.papers.mineru_endpoint"); } },
  "network.recommendation.enabled": { get help() { return message("settings.help.recommendation"); }, dependencies: [], restartRequirement: "none", get label() { return message("settings.label.network.recommendation.enabled"); } },
  "network.recommendation.sort_mode": { get label() { return message("settings.label.network.recommendation.sort_mode"); } },
  "network.recommendation.style": {
    get label() { return message("settings.label.network.recommendation.style"); },
    get help() { return message("settings.help.recommendationStyle"); },
    dependencies: ["network.recommendation.enabled"],
    restartRequirement: "none"
  },
  "assistant.public_audit.enabled": { get label() { return message("settings.label.assistant.public_audit.enabled"); } },
  "profile.local_enabled": { get label() { return message("settings.label.profile.local_enabled"); } },
  "papers.local_mode": { get label() { return message("settings.label.papers.local_mode"); }, get help() { return message("settings.help.localLiterature"); } },
  "profile.enabled": { get label() { return message("settings.label.profile.enabled"); } },
  "assistant.context_window": { get label() { return message("settings.label.assistant.context_window"); }, get help() { return message("settings.help.context"); }, restartRequirement: "next-run" },
  "assistant.default_output_mode": { get label() { return message("settings.label.assistant.default_output_mode"); } },
  "assistant.language": { get help() { return message("settings.help.responseLanguage"); }, dependencies: [], restartRequirement: "next-run", get label() { return message("settings.label.assistant.language"); } },
  "import.ocr_language": { get label() { return message("settings.label.import.ocr_language"); } },
  "thin_reading.intuecho_endpoint": { get label() { return message("settings.label.thin_reading.intuecho_endpoint"); } },
  "models.default_provider": { get label() { return message("settings.label.models.default_provider"); } },
  "models.connection_mode": { get label() { return message("settings.label.models.connection_mode"); } },
  "models.direct_provider": { get label() { return message("settings.label.models.direct_provider"); } },
  "models.direct_endpoint": { get label() { return message("settings.label.models.direct_endpoint"); } },
  "models.direct_model": { get label() { return message("settings.label.models.direct_model"); } },
  "models.direct_protocol": { get label() { return message("settings.label.models.direct_protocol"); } },
  "models.direct_output_format": { get label() { return message("settings.label.models.direct_output_format"); } },
  "models.cloud_proxy_endpoint": { get label() { return message("settings.label.models.cloud_proxy_endpoint"); } },
  "models.control_plane_endpoint": { get label() { return message("settings.label.models.control_plane_endpoint"); } },
  "view.font_family": { get help() { return message("settings.help.interfaceFont"); }, dependencies: [], restartRequirement: "none", get label() { return message("settings.label.view.font_family"); } },
  "view.reader_font_family": { get label() { return message("settings.label.view.reader_font_family"); }, get help() { return message("settings.help.readingFont"); }, dependencies: [], restartRequirement: "none" },
  "view.font_family_zh": { get label() { return message("settings.label.view.font_family_zh"); }, get help() { return message("settings.help.languageFonts"); }, restartRequirement: "none" },
  "view.font_family_en": { get label() { return message("settings.label.view.font_family_en"); }, get help() { return message("settings.help.languageFonts"); }, restartRequirement: "none" },
  "view.reader_font_family_zh": { get label() { return message("settings.label.view.reader_font_family_zh"); }, get help() { return message("settings.help.languageFonts"); }, restartRequirement: "none" },
  "view.reader_font_family_en": { get label() { return message("settings.label.view.reader_font_family_en"); }, get help() { return message("settings.help.languageFonts"); }, restartRequirement: "none" },
  "view.close_empty_panels": { get label() { return message("settings.label.view.close_empty_panels"); }, get help() { return message("settings.help.emptyPanels"); }, restartRequirement: "none" },
  "view.markdown_mode": { get label() { return message("settings.label.view.markdown_mode"); }, get help() { return message("settings.help.markdownMode"); }, dependencies: [], restartRequirement: "none" },
  "view.markdown_autosave": { get label() { return message("settings.label.view.markdown_autosave"); }, get help() { return message("settings.help.autosave"); }, dependencies: [], restartRequirement: "none" },
  "view.list_density": { get label() { return message("settings.label.view.list_density"); }, get help() { return message("settings.help.density"); }, restartRequirement: "none" },
  "view.theme": { get label() { return message("settings.label.view.theme"); }, get help() { return message("settings.help.theme"); }, dependencies: [], restartRequirement: "none" },
  "view.font_size": { get help() { return message("settings.help.fontSize"); }, dependencies: [], restartRequirement: "none", get label() { return message("settings.label.view.font_size"); } },
  "view.display_scale": { get help() { return message("settings.help.scale"); }, dependencies: [], restartRequirement: "none", get label() { return message("settings.label.view.display_scale"); } },
  "view.pdf_preserve_images": { get label() { return message("settings.label.view.pdf_preserve_images"); } },
  "view.pdf_background": { get help() { return message("settings.help.pdfBackground"); }, dependencies: [], restartRequirement: "none", get label() { return message("settings.label.view.pdf_background"); } },
  "view.pdf_custom_background": { get label() { return message("settings.label.view.pdf_custom_background"); } }
};

export function describeObjectSetting(key: string, state: import("./settings.types").SettingsState) {
  const help = settingsRegistry[key as SettingKey]; if (!help?.help) return undefined;
  return { title: settingsRegistry[key as SettingKey].label, text: message("settings.description.value", { label: settingsRegistry[key as SettingKey].label, value: String(state[key as SettingKey]), help: help.help, when: help.restartRequirement === "next-run" ? message("settings.description.nextRun") : message("settings.description.immediate") }) };
}
export const explainableSettingKeys = (Object.keys(settingsRegistry) as SettingKey[]).filter((key) => !!settingsRegistry[key].help);

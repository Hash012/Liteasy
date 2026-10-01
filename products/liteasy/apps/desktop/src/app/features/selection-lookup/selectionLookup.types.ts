export type DictionaryService = "bing" | "youdao" | "free-dictionary";
export type TranslationService = "ai" | "libretranslate";
export type SelectionLookupSettings = {
  "lookup.dictionary_service": DictionaryService;
  "lookup.translation_service": TranslationService;
  "lookup.source_language": string;
  "lookup.target_language": string;
  "lookup.auto_query": boolean;
  "lookup.libretranslate_endpoint": string;
};
export type SelectionLookupSettingKey = keyof SelectionLookupSettings;
export const defaultSelectionLookupSettings: SelectionLookupSettings = {
  "lookup.dictionary_service": "bing",
  "lookup.translation_service": "ai",
  "lookup.source_language": "en",
  "lookup.target_language": "zh",
  "lookup.auto_query": false,
  "lookup.libretranslate_endpoint": "http://localhost:5000"
};
export const dictionaryServices = [
  { id: "bing", label: "必应词典", description: "中文释义与发音" },
  { id: "youdao", label: "有道词典", description: "中文释义与英美发音" },
  { id: "free-dictionary", label: "英英词典", description: "英文释义与例句" }
] as const;
export type SelectionLookupRequest = {
  text: string;
  context?: string;
  paperId?: string;
  paperTitle?: string;
  mode?: "auto" | "translate";
  /** Automatic dictionary lookup must not start AI generation before confirmation. */
  allowTranslation?: boolean;
  systemPrompt?: string;
  signal?: AbortSignal;
};
export type LookupSense = { partOfSpeech?: string; definition: string; example?: string };
export type LookupPronunciation = { label: string; phonetic?: string; audioUrl?: string };
export type SelectionLookupResult = {
  text: string;
  kind: "dictionary" | "translation" | "missing";
  service: string;
  sourceLabel: string;
  sourceUrl?: string;
  senses: LookupSense[];
  pronunciations: LookupPronunciation[];
  translation?: string;
  fallback?: boolean;
};
export type SelectionLookupPort = {
  configurationKey?: string;
  query(request: SelectionLookupRequest): Promise<SelectionLookupResult>;
  autoQuery: boolean;
  translationUsesAi: boolean;
};
export type LookupServiceConfig = { provider: DictionaryService | "libretranslate"; endpoint?: string };
export type LookupTransportRequest = { config: LookupServiceConfig; text: string; sourceLanguage: string; targetLanguage: string; signal?: AbortSignal };
export type LookupTransport = (request: LookupTransportRequest) => Promise<{ status: number; body: string }>;

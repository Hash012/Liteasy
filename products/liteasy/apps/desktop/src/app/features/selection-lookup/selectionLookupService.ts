import { parseDictionaryResult } from "./dictionaryParsers";
import { isDictionarySelection, normalizeLookupText } from "./selectionLookupText";
import { selectionLookupTransport } from "./selectionLookupTransport";
import { defaultSelectionLookupSettings, type LookupTransport, type SelectionLookupRequest, type SelectionLookupResult, type SelectionLookupSettings } from "./selectionLookup.types";

export function createSelectionLookupService(deps: {
  getSettings(): Partial<SelectionLookupSettings>;
  translateAi(request: SelectionLookupRequest & { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  explainAi?(request: { text: string; targetLanguage: string; signal?: AbortSignal }): Promise<string>;
  transport?: LookupTransport;
}) {
  const transport = deps.transport ?? selectionLookupTransport;
  return {
    async query(request: SelectionLookupRequest): Promise<SelectionLookupResult> {
      request.signal?.throwIfAborted();
      const text = normalizeLookupText(request.text);
      if (!text || text.length > 1000) throw new Error("请选中不超过 1,000 字符的单词、短语或短句。");
      const settings = { ...defaultSelectionLookupSettings, ...deps.getSettings() };
      const dictionary = settings["lookup.dictionary_service"];
      const sourceLanguage = settings["lookup.source_language"];
      const targetLanguage = settings["lookup.target_language"];
      if (request.mode === "explain") {
        if (!deps.explainAi) throw new Error("AI 查词暂不可用，请检查模型连接。");
        // A word lookup is intentionally independent of paper, profile and chat context.
        const explanation = await deps.explainAi({ text, targetLanguage, signal: request.signal });
        request.signal?.throwIfAborted();
        if (!explanation.trim()) throw new Error("AI 没有返回释义，请重试。");
        return { text, kind: "explanation", service: "ai", sourceLabel: "AI 查词", explanation: explanation.trim(), senses: [], pronunciations: [] };
      }
      let dictionaryError: unknown;
      let missing: SelectionLookupResult = { text, kind: "missing", service: dictionary,
        sourceLabel: dictionary === "bing" ? "必应词典" : dictionary === "youdao" ? "有道词典" : "英英词典", senses: [], pronunciations: [] };
      const dictionaryLanguage = ["en", "auto"].includes(sourceLanguage) && (dictionary === "free-dictionary" || targetLanguage === "zh");
      if (request.mode !== "translate" && dictionaryLanguage && isDictionarySelection(text)) {
        try {
          const response = await transport({ config: { provider: dictionary }, text, sourceLanguage, targetLanguage, signal: request.signal });
          request.signal?.throwIfAborted();
          if (response.status === 404) missing = { ...missing, kind: "missing" };
          else {
            if (response.status !== 200) throw new Error(`词典查询失败（HTTP ${response.status}），可重试或翻译选段。`);
            missing = parseDictionaryResult(dictionary, text, response.body);
            if (missing.kind === "dictionary") return missing;
          }
        } catch (error) { request.signal?.throwIfAborted(); dictionaryError = error; }
      }
      if (request.mode !== "translate" && request.allowTranslation === false) {
        if (dictionaryError) throw dictionaryError;
        return missing;
      }
      const service = settings["lookup.translation_service"];
      let translation: string;
      if (service === "ai") translation = await deps.translateAi({ ...request, text, sourceLanguage, targetLanguage });
      else {
        const response = await transport({ config: { provider: "libretranslate", endpoint: settings["lookup.libretranslate_endpoint"] },
          text, sourceLanguage, targetLanguage, signal: request.signal });
        if (response.status !== 200) throw new Error(`翻译失败（HTTP ${response.status}），请检查服务地址、密钥或额度。`);
        const data = JSON.parse(response.body);
        translation = typeof data.translatedText === "string" ? data.translatedText : "";
      }
      request.signal?.throwIfAborted();
      if (!translation.trim()) throw new Error("翻译服务没有返回译文，请重试。");
      return { text, kind: "translation", service, sourceLabel: service === "ai" ? "AI 翻译" : "LibreTranslate",
        translation: translation.trim(), senses: [], pronunciations: [], fallback: request.mode !== "translate" };
    }
  };
}

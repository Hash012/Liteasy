import type { DictionaryService, LookupPronunciation, LookupSense, SelectionLookupResult } from "./selectionLookup.types";

function clean(text: string | null | undefined) { return (text ?? "").replace(/\s+/g, " ").trim(); }
function sense(text: string): LookupSense {
  const match = text.match(/^([a-z]+\.(?:\/[a-z]+\.)?)\s*(.+)$/i);
  return match ? { partOfSpeech: match[1], definition: match[2] } : { definition: text };
}
export function safeLookupAudioUrl(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      ["dict.youdao.com", "cn.bing.com", "www.bing.com", "dictionaryapi.dev", "api.dictionaryapi.dev"].includes(url.hostname)
      ? url.href : undefined;
  } catch { return undefined; }
}

export function parseDictionaryResult(provider: DictionaryService, text: string, body: string): SelectionLookupResult {
  const result: SelectionLookupResult = { text, kind: "dictionary", service: provider,
    sourceLabel: provider === "bing" ? "必应词典" : provider === "youdao" ? "有道词典" : "英英词典",
    sourceUrl: provider === "bing" ? `https://cn.bing.com/dict/search?q=${encodeURIComponent(text)}`
      : provider === "youdao" ? `https://www.youdao.com/w/${encodeURIComponent(text)}/` : "https://dictionaryapi.dev/",
    senses: [], pronunciations: [] };
  if (provider === "free-dictionary") {
    const entries: unknown = JSON.parse(body);
    if (!Array.isArray(entries)) return { ...result, kind: "missing" };
    for (const entry of entries.slice(0, 4)) {
      if (!entry || typeof entry !== "object") continue;
      for (const meaning of Array.isArray(entry.meanings) ? entry.meanings : []) {
        for (const definition of Array.isArray(meaning?.definitions) ? meaning.definitions : []) {
          if (typeof definition?.definition !== "string") continue;
          result.senses.push({ partOfSpeech: typeof meaning.partOfSpeech === "string" ? meaning.partOfSpeech : undefined,
            definition: clean(definition.definition), example: typeof definition.example === "string" ? clean(definition.example) : undefined });
        }
      }
      for (const phonetic of Array.isArray(entry.phonetics) ? entry.phonetics : []) {
        if (!phonetic || typeof phonetic !== "object") continue;
        const audioUrl = safeLookupAudioUrl(phonetic.audio);
        const value = typeof phonetic.text === "string" ? clean(phonetic.text) : undefined;
        if (audioUrl || value) result.pronunciations.push({ label: "发音", phonetic: value, audioUrl });
      }
    }
  } else {
    // Parse in an inert document. Never render upstream HTML in the application.
    const doc = new DOMParser().parseFromString(body, "text/html");
    doc.querySelectorAll("script, style").forEach((element) => element.remove());
    if (provider === "youdao") {
      const root = doc.querySelector("#phrsListTab");
      root?.querySelectorAll(".trans-container ul li").forEach((element) => {
        const value = clean(element.textContent); if (value) result.senses.push(sense(value));
      });
      root?.querySelectorAll(".pronounce").forEach((element) => {
        const phonetic = clean(element.querySelector(".phonetic")?.textContent);
        const label = clean(element.textContent).includes("美") ? "美式" : "英式";
        if (phonetic) result.pronunciations.push({ label, phonetic,
          audioUrl: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${label === "美式" ? 2 : 1}` });
      });
    } else {
      doc.querySelectorAll(".qdef ul li").forEach((element) => {
        const definition = clean(element.querySelector(".def")?.textContent);
        if (definition) result.senses.push({ partOfSpeech: clean(element.querySelector(".pos")?.textContent) || undefined, definition });
      });
      if (!result.senses.length) {
        const description = doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
        const definition = description.match(/(?:释义[：:]\s*|，)([a-z]+\.[\s\S]*)/i)?.[1];
        definition?.split(/[；;]\s*/).map(clean).filter(Boolean).forEach((value) => result.senses.push(sense(value)));
      }
      const phonetics = Array.from(doc.querySelectorAll(".hd_area .b_primtxt"));
      const audio = Array.from(doc.querySelectorAll(".hd_area .bigaud"));
      phonetics.forEach((element, index) => {
        const value = clean(element.textContent);
        const path = audio[index]?.getAttribute("data-mp3link");
        let audioUrl: string | undefined;
        try { audioUrl = path ? safeLookupAudioUrl(new URL(path, "https://cn.bing.com").href) : undefined; } catch { /* Keep definitions when an audio link is malformed. */ }
        if (value) result.pronunciations.push({ label: value.includes("美") ? "美式" : "英式", phonetic: value, audioUrl });
      });
    }
  }
  result.senses = result.senses.filter((item) => item.definition).slice(0, 24);
  result.pronunciations = result.pronunciations.slice(0, 4);
  return { ...result, kind: result.senses.length ? "dictionary" : "missing" };
}

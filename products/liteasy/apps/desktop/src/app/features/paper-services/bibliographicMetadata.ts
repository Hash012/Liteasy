import type { LiteratureDisplayRecord } from "../paper-identity/literature.types";
import { readableBibliographicTitle } from "../metadata/pdfRecognition";

type Description = Pick<LiteratureDisplayRecord, "abstract" | "subjects" | "keywords" | "venue" | "publishedAt">;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const clean = (value: unknown, limit = 200) => typeof value === "string" ? readableBibliographicTitle(value).slice(0, limit) : "";
const strings = (values: unknown[]) => [...new Set(values.map((value) => clean(value)).filter(Boolean))].slice(0, 30);

/** Preserve the provider's precision. A year-only publication has no invented month. */
export function bibliographicDate(value: unknown): string | undefined {
  const parts = Array.isArray(value) ? value : typeof value === "string" && /^\d{4}(?:[-/]\d{2}(?:[-/]\d{2})?)?(?:T.*)?$/.test(value)
    ? value.split("T")[0].split(/[-/]/).map(Number) : [];
  const [year, month, day] = parts;
  if (!Number.isInteger(year) || year < 1000 || year > 9999 || parts.length > 3) return undefined;
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) return undefined;
  if (day !== undefined && (!Number.isInteger(day) || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())) return undefined;
  return [year, month, day].filter((part) => part !== undefined).map((part, index) => index ? String(part).padStart(2, "0") : String(part)).join("-");
}

function invertedAbstract(value: unknown) {
  // Bounded positions prevent sparse-array/memory abuse in external responses.
  const words = new Map<number, string>();
  for (const [word, positions] of Object.entries(record(value)).slice(0, 6000)) {
    if (word.length > 200) continue;
    for (const position of array(positions).slice(0, 6000)) {
      if (typeof position === "number" && Number.isInteger(position) && position >= 0 && position < 6000) words.set(position, word);
    }
  }
  return clean([...words].sort((a, b) => a[0] - b[0]).map(([, word]) => word).join(" "), 12000);
}

export function readBibliographicMetadata(value: unknown): Description {
  const item = record(value);
  const abstract = clean(item.abstract, 12000) || invertedAbstract(item.abstract_inverted_index);
  const topics = array(item.topics).map(record);
  const subjects = strings([...array(item.subject), ...array(item.fieldsOfStudy), ...array(item.s2FieldsOfStudy).map((field) => record(field).category),
    ...topics.flatMap((topic) => [topic.display_name, record(topic.subfield).display_name, record(topic.field).display_name]),
    ...array(item.concepts).filter((concept) => Number(record(concept).score) >= 0.3).map((concept) => record(concept).display_name)]);
  const keywords = strings(array(item.keywords).map((word) => typeof word === "string" ? word : record(word).display_name));
  const venue = clean(array(item["container-title"])[0] ?? record(record(item.primary_location).source).display_name ?? item.venue ?? record(item.journal).name, 500);
  const dates = [item.publication_date, item.publicationDate,
    ...["published", "published-online", "published-print", "issued"].map((field) => array(record(item[field])["date-parts"])[0])]
    .map(bibliographicDate).filter((date): date is string => Boolean(date));
  // Prefer the first publication; use a more precise value when it shares a year/month.
  const publishedAt = dates.sort((a, b) => a.startsWith(b) ? -1 : b.startsWith(a) ? 1 : a.localeCompare(b))[0];
  return { ...(abstract ? { abstract } : {}), ...(subjects.length ? { subjects } : {}), ...(keywords.length ? { keywords } : {}),
    ...(venue ? { venue } : {}), ...(publishedAt ? { publishedAt } : {}) };
}

export function pdfDescriptiveMetadata(text: string): Pick<Description, "abstract" | "keywords"> {
  const bounded = text.slice(0, 20000);
  const abstract = /(?:^|\n)\s*(?:a\s*b\s*s\s*t\s*r\s*a\s*c\s*t|摘要)\s*[:：.—-]?\s*([\s\S]+?)(?=\n\s*(?:\d+[.\s]+)?(?:introduction|keywords?|index terms|引言|关键词)\b|$)/i.exec(bounded)?.[1]?.trim();
  const keywords = /(?:^|\n)\s*(?:keywords?|index terms|关键词)\s*[:：.—-]\s*([^\n]+)/i.exec(bounded)?.[1];
  return { ...(abstract && abstract.length >= 40 ? { abstract: abstract.replace(/\s+/g, " ").slice(0, 12000) } : {}),
    ...(keywords ? { keywords: strings(keywords.split(/[;,，；]/)) } : {}) };
}

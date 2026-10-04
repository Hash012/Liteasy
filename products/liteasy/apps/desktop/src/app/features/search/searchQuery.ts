import { RE2JS } from "re2js";

export type SearchMetadata = { tags?: readonly string[]; format?: string; assetType?: string };
export type SearchRange = { start: number; end: number };
export type SearchFacet = "tag" | "format" | "type";
type Token = { raw: string; value: string; field?: SearchFacet; exclude?: boolean; regex?: boolean; flags?: string };
export const searchFormat = (value = "") => ({ md: "markdown", text: "txt", htm: "html", azw: "mobi", azw3: "mobi", kfx: "mobi" }[value.toLowerCase().replace(/^\./, "")] ?? value.toLowerCase().replace(/^\./, ""));
export const formatFromName = (name = "") => searchFormat(name.split(/[?#]/)[0].split(".").at(-1) ?? "");
export const normalizeSearchValue = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();

function tokenize(query: string): Token[] {
  if (query.length > 2048) throw new Error("检索内容过长，请缩短到 2048 字符以内。");
  const tokens: Token[] = [];
  let i = 0;
  while (i < query.length) {
    if (/\s/u.test(query[i])) { i++; continue; }
    const start = i;
    const prefix = /^(-?)(tag|format|type|re|regex):/i.exec(query.slice(i));
    if (prefix) i += prefix[0].length;
    let value = "", quoted = false, quote = "";
    const slash = query[i] === "/" && !prefix;
    if (slash) {
      let end = i + 1;
      for (; end < query.length; end++) { if (query[end] === "\\") end++; else if (query[end] === "/") break; }
      if (end < query.length && /^[ims]*(?:\s|$)/.test(query.slice(end + 1))) {
        value = query.slice(i + 1, end); i = end + 1;
        const flags = /^[ims]*/.exec(query.slice(i))![0]; i += flags.length;
        tokens.push({ raw: query.slice(start, i), value, regex: true, flags }); continue;
      }
    }
    for (; i < query.length; i++) {
      const char = query[i];
      if (quoted && char === "\\" && (query[i + 1] === quote || query[i + 1] === "\\")) { value += query[++i]; continue; }
      if (char === '"' || char === "“" || char === "”") {
        if (quoted) { quoted = false; } else { quoted = true; quote = char === "“" ? "”" : char; } continue;
      }
      if (!quoted && /\s/u.test(char)) break;
      value += char;
    }
    if (quoted) throw new Error("请补上短语右侧的引号。");
    if (prefix && !value.trim()) throw new Error(`请在 ${prefix[2]}: 后填写条件。`);
    const field = prefix?.[2].toLowerCase();
    tokens.push({ raw: query.slice(start, i), value, ...(field === "re" || field === "regex" ? { regex: true } : field ? { field: field as SearchFacet, exclude: prefix?.[1] === "-" } : {}) });
  }
  if (tokens.length > 32) throw new Error("一次最多使用 32 个检索条件。");
  return tokens;
}

// Retain source offsets through case/width folding, so highlights never select a different glyph.
export function foldSearchText(value: string, matchCase = false) {
  let text = "", offset = 0;
  const starts: number[] = [], ends: number[] = [];
  for (const point of value) {
    const next = offset + point.length;
    let folded = point.normalize("NFKC");
    if (!matchCase) folded = folded.toLowerCase();
    for (const char of folded) {
      if (/\s/u.test(char)) {
        if (text.endsWith(" ")) { ends[ends.length - 1] = next; continue; }
        text += " "; starts.push(offset); ends.push(next);
      } else { text += char; for (let i = 0; i < char.length; i++) { starts.push(offset); ends.push(next); } }
    }
    offset = next;
  }
  return { text, starts, ends };
}

export function compileSearchQuery(query: string, options: { phrase?: boolean; matchCase?: boolean; wholeWords?: boolean } = {}) {
  let tokens: Token[] = [], error = "";
  const patterns: RE2JS[] = [];
  let terms: string[] = [];
  try {
    tokens = tokenize(query);
    terms = tokens.filter((token) => !token.field && !token.regex).map((token) => token.value).filter((value) => Boolean(value.trim()));
    if (options.phrase && terms.length) terms = [terms.join(" ")];
    if (terms.length > 16) throw new Error("一次最多检索 16 个词或短语。");
    for (const token of tokens.filter((token) => token.regex)) {
      if (token.value.length > 512) throw new Error("正则表达式最长 512 字符。");
      const flags = RE2JS.MULTILINE | (!options.matchCase || token.flags?.includes("i") ? RE2JS.CASE_INSENSITIVE : 0) | (token.flags?.includes("s") ? RE2JS.DOTALL : 0);
      try { patterns.push(RE2JS.compile(token.value, flags)); }
      catch { throw new Error("正则表达式无效或使用了不支持的语法（如反向引用、环视）。"); }
    }
  } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const whole = (text: string, start: number, end: number) => !options.wholeWords || (!/[\p{L}\p{N}_]/u.test(text[start - 1] ?? "") && !/[\p{L}\p{N}_]/u.test(text[end] ?? ""));
  const metadata = (item: SearchMetadata = {}) => {
    if (error) return false;
    const tags = new Set((item.tags ?? []).map(normalizeSearchValue));
    for (const field of ["tag", "format", "type"] as const) {
      const selected = tokens.filter((token) => token.field === field);
      const has = (token: Token) => field === "tag" ? tags.has(normalizeSearchValue(token.value)) : field === "format"
        ? searchFormat(item.format) === searchFormat(token.value) : normalizeSearchValue(item.assetType ?? "") === normalizeSearchValue(token.value);
      if (selected.some((token) => token.exclude && has(token))) return false;
      const included = selected.filter((token) => !token.exclude);
      if (included.length && !(field === "tag" ? included.every(has) : included.some(has))) return false;
    }
    return true;
  };
  function ranges(value: string, limit = 200): SearchRange[] {
    if (error) return [];
    const matches: SearchRange[] = [];
    if (terms.length) {
      const folded = foldSearchText(value, options.matchCase);
      for (const term of terms) {
        const needle = foldSearchText(term, options.matchCase).text.trim();
        if (!needle) continue;
        for (let from = 0, count = 0; count < limit;) {
          const start = folded.text.indexOf(needle, from); if (start < 0) break;
          const end = start + needle.length; from = end;
          if (whole(folded.text, start, end)) { matches.push({ start: folded.starts[start], end: folded.ends[end - 1] }); count++; }
        }
      }
    }
    for (const pattern of patterns) {
      const matcher = pattern.matcher(value); let count = 0;
      while (count < limit && matcher.find()) {
        const start = matcher.start(), end = matcher.end();
        if (end > start && whole(value, start, end)) { matches.push({ start, end }); count++; }
      }
    }
    const merged: SearchRange[] = [];
    for (const range of matches.sort((a, b) => a.start - b.start || a.end - b.end)) {
      const previous = merged.at(-1);
      if (previous && previous.end >= range.start) previous.end = Math.max(previous.end, range.end); else merged.push(range);
    }
    return merged.slice(0, limit);
  }
  function textMatches(value: string) {
    if (error) return false;
    const folded = terms.length ? foldSearchText(value, options.matchCase).text : "";
    return terms.every((term) => {
      const needle = foldSearchText(term, options.matchCase).text.trim();
      let from = 0, at;
      while ((at = folded.indexOf(needle, from)) >= 0) { if (whole(folded, at, at + needle.length)) return true; from = at + Math.max(1, needle.length); }
      return false;
    }) && patterns.every((pattern) => { const matcher = pattern.matcher(value); while (matcher.find()) if (matcher.end() > matcher.start() && whole(value, matcher.start(), matcher.end())) return true; return false; });
  }
  return { error, tokens, terms, hasText: terms.length > 0 || patterns.length > 0, advanced: tokens.some((token) => token.field || token.regex),
    metadata, ranges, textMatches, matches: (text: string, item?: SearchMetadata) => metadata(item) && textMatches(text) };
}
export function updateSearchFacet(query: string, field: SearchFacet, value: string, exclude: boolean, enabled: boolean) {
  let tokens: Token[]; try { tokens = tokenize(query); } catch { return query; }
  const retained = tokens.filter((token) => token.field !== field || normalizeSearchValue(token.value) !== normalizeSearchValue(value));
  return [...retained.map((token) => token.raw), ...(enabled ? [`${exclude ? "-" : ""}${field}:${JSON.stringify(value)}`] : [])].join(" ");
}

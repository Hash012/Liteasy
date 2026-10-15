/** Normalize display overrides without changing registry-confirmed document identity. */
export function normalizeBibliographicDoi(value: string) {
  return value.trim().replace(/^doi:\s*/i, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim();
}

export function bibliographicDoiUrl(value: string) {
  const doi = normalizeBibliographicDoi(value);
  return doi ? `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}` : "";
}

export function bibliographicIdentifierError(value: { doi: string; url: string }) {
  if (value.doi && !/^10\.\d{4,9}\/\S+$/i.test(normalizeBibliographicDoi(value.doi))) {
    return "DOI 请填写 10. 开头的标识或 doi.org 链接，或留空。";
  }
  if (value.url) {
    try {
      const url = new URL(value.url);
      if (!/^https?:\/\//i.test(value.url) || /\s/.test(value.url) || !url.hostname || !["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      return "网址请使用完整的 http:// 或 https:// 地址，或留空。";
    }
  }
  return "";
}

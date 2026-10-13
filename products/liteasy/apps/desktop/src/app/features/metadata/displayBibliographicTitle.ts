/** Plain display text only. No DOM construction, resource loading, or record mutation. */
export function displayBibliographicTitle(value: string, maxLength = 4000) {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", times: "×", le: "≤", ge: "≥", minus: "−", plusmn: "±", alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", phi: "φ", omega: "ω" };
  let plain = value.slice(0, 100_000);
  for (let pass = 0; pass < 8; pass++) {
    const before = plain;
    plain = plain.replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
      .replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ")
      .replace(/<(?:[\w-]+:)?sup\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?sup>/gi, "^($1)")
      .replace(/<(?:[\w-]+:)?sub\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?sub>/gi, "_($1)")
      .replace(/<\/?(?:[\w-]+:)?(?:p|div|br|li|title|mrow|mfrac)\b[^>]*>/gi, " ")
      .replace(/<\/?[a-z][\w:.-]*(?:\s[^<>]*|\/?)>/gi, "")
      .replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (whole, code: string) => {
        if (!code.startsWith("#")) return entities[code] ?? whole;
        const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "�";
      });
    if (plain === before) break;
  }
  return plain.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

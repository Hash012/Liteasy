import type { MineruFigure } from "./import.types";

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeMineruAssetPath(value: string) {
  const withoutSuffix = safeDecode(value.trim())
    .replace(/^<|>$/g, "")
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
  const segments: string[] = [];
  for (const segment of withoutSuffix.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/").toLocaleLowerCase();
}

function safeImageDataUrl(value: string) {
  return /^data:image\/(?:avif|gif|jpe?g|png|svg\+xml|webp);/i.test(value);
}

function uniqueResolvedSource(figures: readonly MineruFigure[]) {
  const sources = [...new Set(figures
    .map((figure) => figure.dataUrl)
    .filter(safeImageDataUrl))];
  return sources.length === 1 ? sources[0] : undefined;
}

function assetBasename(value: string) {
  const segments = value.split("/");
  return segments[segments.length - 1];
}

/** Resolve only against images already attached to the current MinerU document. */
export function resolveMineruImageSource(
  value: string | undefined,
  figures: readonly MineruFigure[]
) {
  if (!value) return undefined;
  if (safeImageDataUrl(value)) return value;
  try {
    new URL(value, window.location.href);
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) {
      return undefined;
    }
  } catch {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) {
      return undefined;
    }
  }

  const target = normalizeMineruAssetPath(value);
  if (!target) return undefined;
  const candidates = figures.filter((figure) => safeImageDataUrl(figure.dataUrl));
  const exact = candidates.filter((figure) => normalizeMineruAssetPath(figure.sourcePath) === target);
  const exactSource = uniqueResolvedSource(exact);
  if (exactSource) return exactSource;

  const suffix = candidates.filter((figure) => {
    const source = normalizeMineruAssetPath(figure.sourcePath);
    return source.endsWith(`/${target}`) || target.endsWith(`/${source}`);
  });
  const suffixSource = uniqueResolvedSource(suffix);
  if (suffixSource) return suffixSource;

  const basename = assetBasename(target);
  if (!basename) return undefined;
  return uniqueResolvedSource(candidates.filter((figure) => (
    assetBasename(normalizeMineruAssetPath(figure.sourcePath)) === basename
  )));
}

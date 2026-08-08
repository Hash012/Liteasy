export type GeneratedThemeScope =
  | "global"
  | "reader"
  | "panels"
  | "tabs"
  | "buttons"
  | "floating_controls";

export type GeneratedThemeButtonShadow = "none" | "subtle" | "raised" | "crisp";
export type GeneratedThemeButtonFill = "flat" | "soft" | "solid" | "glass";
export type GeneratedThemeButtonWeight = "quiet" | "balanced" | "strong";
export type GeneratedThemeDensity = "compact" | "comfortable" | "spacious";

export type GeneratedThemePalette = {
  accent1: string;
  accent2: string;
  accent3: string;
  ink1: string;
  ink2: string;
  line1: string;
  line2: string;
  paper0: string;
  paper1: string;
  paper2: string;
};

export type GeneratedThemeButtons = {
  borderWidth: number;
  fill: GeneratedThemeButtonFill;
  hoverLift: number;
  radius: number;
  shadow: GeneratedThemeButtonShadow;
  weight: GeneratedThemeButtonWeight;
};

export type GeneratedThemeSurfaces = {
  blur?: number;
  surface1Alpha?: number;
  surface2Alpha?: number;
};

export type GeneratedThemeInput = {
  buttons: GeneratedThemeButtons;
  density?: GeneratedThemeDensity;
  intent: string;
  name: string;
  palette: GeneratedThemePalette;
  rationale?: string;
  scope: GeneratedThemeScope[];
  surfaces?: GeneratedThemeSurfaces;
};

export type GeneratedTheme = GeneratedThemeInput;

export type GeneratedThemeParseResult =
  | {
      ok: true;
      theme: GeneratedTheme;
    }
  | {
      errors: string[];
      ok: false;
    };

export type GeneratedThemeStyle = Record<string, string>;

const hexColorPattern = /^#[0-9A-Fa-f]{6}$/;
const scopes = new Set<GeneratedThemeScope>([
  "global",
  "reader",
  "panels",
  "tabs",
  "buttons",
  "floating_controls"
]);
const shadows = new Set<GeneratedThemeButtonShadow>(["none", "subtle", "raised", "crisp"]);
const fills = new Set<GeneratedThemeButtonFill>(["flat", "soft", "solid", "glass"]);
const weights = new Set<GeneratedThemeButtonWeight>(["quiet", "balanced", "strong"]);
const densities = new Set<GeneratedThemeDensity>(["compact", "comfortable", "spacious"]);

const paletteKeys: Array<keyof GeneratedThemePalette> = [
  "accent1",
  "accent2",
  "accent3",
  "ink1",
  "ink2",
  "line1",
  "line2",
  "paper0",
  "paper1",
  "paper2"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function readText(value: unknown, path: string, errors: string[]) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 80) {
    errors.push(`${path} must be a non-empty string under 80 characters`);
    return "";
  }

  return value;
}

function parsePalette(value: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("palette must be an object");
    return null;
  }

  const initialErrorCount = errors.length;
  const palette = {} as GeneratedThemePalette;
  for (const key of paletteKeys) {
    const color = value[key];
    if (typeof color !== "string" || !hexColorPattern.test(color)) {
      errors.push(`palette.${key} must be a #RRGGBB hex color`);
      continue;
    }
    palette[key] = color.toUpperCase();
  }

  if (errors.length > initialErrorCount) {
    return null;
  }

  return palette;
}

function parseButtons(value: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("buttons must be an object");
    return null;
  }

  if (!isBoundedNumber(value.radius, 0, 18)) {
    errors.push("buttons.radius must be between 0 and 18");
  }
  if (!isBoundedNumber(value.borderWidth, 0, 3)) {
    errors.push("buttons.borderWidth must be between 0 and 3");
  }
  if (!isBoundedNumber(value.hoverLift, 0, 6)) {
    errors.push("buttons.hoverLift must be between 0 and 6");
  }
  if (typeof value.shadow !== "string" || !shadows.has(value.shadow as GeneratedThemeButtonShadow)) {
    errors.push("buttons.shadow is invalid");
  }
  if (typeof value.fill !== "string" || !fills.has(value.fill as GeneratedThemeButtonFill)) {
    errors.push("buttons.fill is invalid");
  }
  if (typeof value.weight !== "string" || !weights.has(value.weight as GeneratedThemeButtonWeight)) {
    errors.push("buttons.weight is invalid");
  }

  if (errors.length > 0) {
    return null;
  }

  return {
    borderWidth: value.borderWidth,
    fill: value.fill,
    hoverLift: value.hoverLift,
    radius: value.radius,
    shadow: value.shadow,
    weight: value.weight
  } as GeneratedThemeButtons;
}

function parseSurfaces(value: unknown, errors: string[]) {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push("surfaces must be an object");
    return undefined;
  }

  const surfaces: GeneratedThemeSurfaces = {};
  const surface1Alpha = value.surface1Alpha;
  const surface2Alpha = value.surface2Alpha;
  const blur = value.blur;
  if (surface1Alpha !== undefined) {
    if (!isBoundedNumber(surface1Alpha, 0.55, 1)) {
      errors.push("surfaces.surface1Alpha must be between 0.55 and 1");
    } else {
      surfaces.surface1Alpha = surface1Alpha;
    }
  }
  if (surface2Alpha !== undefined) {
    if (!isBoundedNumber(surface2Alpha, 0.55, 1)) {
      errors.push("surfaces.surface2Alpha must be between 0.55 and 1");
    } else {
      surfaces.surface2Alpha = surface2Alpha;
    }
  }
  if (blur !== undefined) {
    if (!isBoundedNumber(blur, 0, 20)) {
      errors.push("surfaces.blur must be between 0 and 20");
    } else {
      surfaces.blur = blur;
    }
  }

  return surfaces;
}

function parseScope(value: unknown, errors: string[]) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("scope must be a non-empty array");
    return [];
  }

  const parsed: GeneratedThemeScope[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !scopes.has(item as GeneratedThemeScope)) {
      errors.push("scope contains an invalid layer");
      continue;
    }
    if (!parsed.includes(item as GeneratedThemeScope)) {
      parsed.push(item as GeneratedThemeScope);
    }
  }

  return parsed;
}

function hexToRgb(hex: string) {
  return {
    b: Number.parseInt(hex.slice(5, 7), 16) / 255,
    g: Number.parseInt(hex.slice(3, 5), 16) / 255,
    r: Number.parseInt(hex.slice(1, 3), 16) / 255
  };
}

function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(a: string, b: string) {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function validateContrast(palette: GeneratedThemePalette, errors: string[]) {
  if (contrastRatio(palette.paper0, palette.ink1) < 4.5) {
    errors.push("palette.paper0 and palette.ink1 must have at least 4.5 contrast");
  }
  if (contrastRatio(palette.paper1, palette.ink1) < 4.5) {
    errors.push("palette.paper1 and palette.ink1 must have at least 4.5 contrast");
  }
  if (contrastRatio(palette.paper0, palette.ink2) < 3) {
    errors.push("palette.paper0 and palette.ink2 must have at least 3 contrast");
  }
}

function rgbaFromHex(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

function buttonShadowValue(shadow: GeneratedThemeButtonShadow) {
  if (shadow === "none") {
    return "none";
  }
  if (shadow === "crisp") {
    return "0 1px 0 rgba(24, 34, 47, 0.28)";
  }
  if (shadow === "raised") {
    return "0 10px 24px rgba(24, 34, 47, 0.16)";
  }

  return "0 6px 14px rgba(24, 34, 47, 0.10)";
}

function buttonWeightValue(weight: GeneratedThemeButtonWeight) {
  if (weight === "quiet") {
    return "650";
  }
  if (weight === "strong") {
    return "850";
  }

  return "750";
}

function buttonFillValue(theme: GeneratedTheme) {
  const { accent1, accent2, ink1, line1, paper0, paper1 } = theme.palette;

  if (theme.buttons.fill === "flat") {
    return {
      background: "transparent",
      borderColor: line1,
      color: accent1,
      hoverBackground: rgbaFromHex(accent1, 0.1)
    };
  }

  if (theme.buttons.fill === "soft") {
    return {
      background: rgbaFromHex(accent1, 0.12),
      borderColor: rgbaFromHex(accent1, 0.28),
      color: ink1,
      hoverBackground: rgbaFromHex(accent1, 0.18)
    };
  }

  if (theme.buttons.fill === "glass") {
    return {
      background: rgbaFromHex(paper0, 0.68),
      borderColor: rgbaFromHex(accent1, 0.34),
      color: ink1,
      hoverBackground: rgbaFromHex(paper1, 0.86)
    };
  }

  return {
    background: accent1,
    borderColor: accent1,
    color: paper0,
    hoverBackground: accent2
  };
}

export function parseGeneratedThemeInput(value: unknown): GeneratedThemeParseResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return {
      errors: ["theme input must be an object"],
      ok: false
    };
  }

  const name = readText(value.name, "name", errors);
  const intent = readText(value.intent, "intent", errors);
  const palette = parsePalette(value.palette, errors);
  const buttons = parseButtons(value.buttons, errors);
  const scope = parseScope(value.scope, errors);
  const surfaces = parseSurfaces(value.surfaces, errors);
  const density = value.density;
  if (density !== undefined && (typeof density !== "string" || !densities.has(density as GeneratedThemeDensity))) {
    errors.push("density is invalid");
  }
  const rationale = value.rationale;
  if (rationale !== undefined && (typeof rationale !== "string" || rationale.length > 160)) {
    errors.push("rationale must be a string under 160 characters");
  }

  if (palette) {
    validateContrast(palette, errors);
  }

  if (errors.length > 0 || !palette || !buttons || scope.length === 0) {
    return {
      errors,
      ok: false
    };
  }

  return {
    ok: true,
    theme: {
      buttons,
      density: density as GeneratedThemeDensity | undefined,
      intent,
      name,
      palette,
      rationale: rationale as string | undefined,
      scope,
      surfaces
    }
  };
}

export function createGeneratedThemeStyle(theme: GeneratedTheme): GeneratedThemeStyle {
  const surface1Alpha = theme.surfaces?.surface1Alpha ?? 0.9;
  const surface2Alpha = theme.surfaces?.surface2Alpha ?? 0.86;
  const buttonFill = buttonFillValue(theme);

  return {
    "--button-background": buttonFill.background,
    "--button-border-color": buttonFill.borderColor,
    "--button-border-width": `${theme.buttons.borderWidth}px`,
    "--button-color": buttonFill.color,
    "--button-font-weight": buttonWeightValue(theme.buttons.weight),
    "--button-hover-background": buttonFill.hoverBackground,
    "--button-hover-transform": `translateY(-${theme.buttons.hoverLift}px)`,
    "--button-radius": `${theme.buttons.radius}px`,
    "--button-shadow": buttonShadowValue(theme.buttons.shadow),
    "--generated-accent-1": theme.palette.accent1,
    "--generated-accent-2": theme.palette.accent2,
    "--generated-accent-3": theme.palette.accent3,
    "--generated-ink-1": theme.palette.ink1,
    "--generated-ink-2": theme.palette.ink2,
    "--generated-line-1": theme.palette.line1,
    "--generated-line-2": theme.palette.line2,
    "--generated-paper-0": theme.palette.paper0,
    "--generated-paper-1": theme.palette.paper1,
    "--generated-paper-2": theme.palette.paper2,
    "--generated-surface-1": rgbaFromHex(theme.palette.paper0, surface1Alpha),
    "--generated-surface-2": rgbaFromHex(theme.palette.paper1, surface2Alpha),
    "--generated-theme-blur": `${theme.surfaces?.blur ?? 0}px`,
    "--generated-theme-fill": theme.buttons.fill,
    "--generated-theme-weight": theme.buttons.weight
  };
}

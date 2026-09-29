import { defaultAcademicProfile, type AcademicProfile } from "./profile.types";
import { resolveLocalAccountKey } from "../library/localAccountKey";

const academicProfileStorageKey = "liteasy.academic-profile.v1";

function scopedAcademicProfileStorageKey(scope: string) {
  return `${academicProfileStorageKey}:${scope}`;
}

function loadScopedAcademicProfileValue(scope: string) {
  const scopedKey = scopedAcademicProfileStorageKey(scope);
  const scopedValue = window.localStorage.getItem(scopedKey);
  if (scopedValue !== null) return scopedValue;
  if (scope !== "guest") return null;
  const legacyValue = window.localStorage.getItem(academicProfileStorageKey);
  if (legacyValue !== null) {
    window.localStorage.setItem(scopedKey, legacyValue);
    window.localStorage.removeItem(academicProfileStorageKey);
  }
  return legacyValue;
}

function isAcademicProfile(value: unknown): value is AcademicProfile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<Record<keyof AcademicProfile, unknown>>;
  const disciplines = candidate.disciplines;
  const validDisciplines = typeof disciplines === "undefined" || (
    Array.isArray(disciplines) && disciplines.every((discipline) => {
      if (!discipline || typeof discipline !== "object") {
        return false;
      }
      const item = discipline as Record<string, unknown>;
      return ["categoryCode", "categoryName", "code", "description", "name"]
        .every((key) => typeof item[key] === "string");
    })
  );
  return validDisciplines && Object.entries(defaultAcademicProfile).every(([key, defaultValue]) =>
    Array.isArray(defaultValue) || typeof candidate[key as keyof AcademicProfile] === "string"
  );
}

export function loadAcademicProfile(scope = resolveLocalAccountKey()): AcademicProfile {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...defaultAcademicProfile };
  }
  try {
    const parsed: unknown = JSON.parse(
      loadScopedAcademicProfileValue(scope) ?? "null"
    );
    return isAcademicProfile(parsed)
      ? { ...defaultAcademicProfile, ...parsed, disciplines: parsed.disciplines ?? [] }
      : { ...defaultAcademicProfile, disciplines: [] };
  } catch {
    return { ...defaultAcademicProfile };
  }
}

export function saveAcademicProfile(profile: AcademicProfile, scope = resolveLocalAccountKey()) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(scopedAcademicProfileStorageKey(scope), JSON.stringify(profile));
  } catch {
    // Device-local persistence is best-effort in quota-constrained webviews.
  }
}

export function clearAcademicProfile(scope = resolveLocalAccountKey()) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(scopedAcademicProfileStorageKey(scope));
  } catch {
    // Device-local persistence is best-effort in quota-constrained webviews.
  }
}

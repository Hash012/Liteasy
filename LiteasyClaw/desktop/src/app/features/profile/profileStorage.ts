import { defaultAcademicProfile, type AcademicProfile } from "./profile.types";

const academicProfileStorageKey = "liteasy.academic-profile.v1";

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

export function loadAcademicProfile(): AcademicProfile {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...defaultAcademicProfile };
  }
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(academicProfileStorageKey) ?? "null");
    return isAcademicProfile(parsed)
      ? { ...defaultAcademicProfile, ...parsed, disciplines: parsed.disciplines ?? [] }
      : { ...defaultAcademicProfile, disciplines: [] };
  } catch {
    return { ...defaultAcademicProfile };
  }
}

export function saveAcademicProfile(profile: AcademicProfile) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(academicProfileStorageKey, JSON.stringify(profile));
  } catch {
    // Device-local persistence is best-effort in quota-constrained webviews.
  }
}

export function clearAcademicProfile() {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(academicProfileStorageKey);
  } catch {
    // Device-local persistence is best-effort in quota-constrained webviews.
  }
}

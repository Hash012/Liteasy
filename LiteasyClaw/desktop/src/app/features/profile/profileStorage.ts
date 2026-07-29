import { defaultAcademicProfile, type AcademicProfile } from "./profile.types";

const academicProfileStorageKey = "liteasy.academic-profile.v1";

function isAcademicProfile(value: unknown): value is AcademicProfile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<Record<keyof AcademicProfile, unknown>>;
  return (
    typeof candidate.age === "string" &&
    Array.isArray(candidate.disciplines) &&
    typeof candidate.gender === "string" &&
    typeof candidate.preferredLanguages === "string" &&
    typeof candidate.researchDatasets === "string" &&
    typeof candidate.researchMethods === "string" &&
    typeof candidate.researchTopics === "string" &&
    typeof candidate.stage === "string"
  );
}

export function loadAcademicProfile(): AcademicProfile {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...defaultAcademicProfile };
  }
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(academicProfileStorageKey) ?? "null");
    return isAcademicProfile(parsed) ? parsed : { ...defaultAcademicProfile };
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

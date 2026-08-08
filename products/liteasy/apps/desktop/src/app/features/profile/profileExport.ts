import type { AcademicProfile } from "./profile.types";

export type AcademicProfileExport = {
  academicProfile: AcademicProfile;
  exportedAt: string;
};

export function createAcademicProfileExport(input: {
  academicProfile: AcademicProfile;
  exportedAt?: string;
}): AcademicProfileExport {
  return {
    academicProfile: input.academicProfile,
    exportedAt: input.exportedAt ?? new Date().toISOString()
  };
}

export function downloadAcademicProfileExport(profileExport: AcademicProfileExport) {
  const blob = new Blob([JSON.stringify(profileExport, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "liteasy-academic-profile.json";
  link.click();
  URL.revokeObjectURL(url);
}

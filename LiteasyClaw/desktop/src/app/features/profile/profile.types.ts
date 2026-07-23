export type AcademicProfile = {
  disciplines: AcademicDiscipline[];
  stage: string;
};

export type AcademicDiscipline = {
  categoryCode: string;
  categoryName: string;
  code: string;
  description: string;
  name: string;
};

export type DisciplineCatalogItem = Omit<AcademicDiscipline, "description">;

export const defaultAcademicProfile: AcademicProfile = {
  disciplines: [],
  stage: "未设置"
};

export function formatAcademicProfile(profile: AcademicProfile) {
  return profile.stage;
}

export function formatAcademicResearchProfile(profile: AcademicProfile) {
  if (profile.disciplines.length === 0) {
    return "未设置";
  }

  return profile.disciplines
    .map((discipline) => {
      const label = `${discipline.categoryName} · ${discipline.name}`;
      return discipline.description ? `${label}（${discipline.description}）` : label;
    })
    .join("；");
}

export function buildAcademicProfileAssistantSummary(profile: AcademicProfile) {
  const fields = [
    profile.stage !== "未设置" ? ["研究阶段", profile.stage] : undefined,
    profile.disciplines.length > 0 ? ["研究学科", formatAcademicResearchProfile(profile)] : undefined
  ].filter((field): field is [string, string] => Boolean(field));

  if (fields.length === 0) {
    return undefined;
  }

  return fields.map(([label, value]) => `${label}：${value}`).join("；");
}

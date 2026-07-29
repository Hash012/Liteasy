export type AcademicDiscipline = {
  categoryCode: string;
  categoryName: string;
  code: string;
  description: string;
  name: string;
};

export type DisciplineCatalogItem = Omit<AcademicDiscipline, "description">;

export type AcademicProfile = {
  age: string;
  disciplines: AcademicDiscipline[];
  gender: string;
  preferredLanguages: string;
  researchDatasets: string;
  researchMethods: string;
  researchTopics: string;
  stage: string;
};

export type RecommendationResearchProfile = {
  datasets: string[];
  languages: string[];
  methods: string[];
  topics: string[];
};

export const defaultAcademicProfile: AcademicProfile = {
  age: "未设置",
  disciplines: [],
  gender: "未设置",
  preferredLanguages: "",
  researchDatasets: "",
  researchMethods: "",
  researchTopics: "",
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
      const label = `${discipline.categoryName} / ${discipline.name}`;
      return discipline.description ? `${label}（${discipline.description}）` : label;
    })
    .join("；");
}

export function splitResearchProfileValues(value: string, limit = 12) {
  const items = value
    .split(/[\n,，；、;]+/)
    .map((item) => item.trim().replace(/\s+/g, " ").slice(0, 80))
    .filter(Boolean);
  return [...new Set(items)].slice(0, limit);
}

export function toRecommendationResearchProfile(
  profile: AcademicProfile
): RecommendationResearchProfile | undefined {
  const researchProfile = {
    datasets: splitResearchProfileValues(profile.researchDatasets),
    languages: splitResearchProfileValues(profile.preferredLanguages, 6),
    methods: splitResearchProfileValues(profile.researchMethods),
    topics: [
      ...splitResearchProfileValues(profile.researchTopics),
      ...profile.disciplines.map((discipline) => discipline.name)
    ].slice(0, 12)
  };
  return Object.values(researchProfile).some((items) => items.length > 0)
    ? researchProfile
    : undefined;
}

export function buildAcademicProfileAssistantSummary(profile: AcademicProfile) {
  const fields = [
    profile.stage !== "未设置" ? ["研究阶段", profile.stage] : undefined,
    profile.disciplines.length > 0 ? ["研究学科", formatAcademicResearchProfile(profile)] : undefined,
    profile.researchTopics ? ["研究主题", splitResearchProfileValues(profile.researchTopics, 2).join("、")] : undefined,
    profile.researchMethods ? ["研究方法", splitResearchProfileValues(profile.researchMethods, 2).join("、")] : undefined,
    profile.researchDatasets ? ["研究数据", splitResearchProfileValues(profile.researchDatasets, 2).join("、")] : undefined,
    profile.preferredLanguages ? ["偏好语言", splitResearchProfileValues(profile.preferredLanguages, 2).join("、")] : undefined
  ].filter((field): field is [string, string] => Boolean(field));

  return fields.length > 0
    ? fields.map(([label, value]) => `${label}：${value}`).join("；")
    : undefined;
}

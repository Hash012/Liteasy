export type DisciplineCatalogItem = {
  categoryCode: string;
  categoryName: string;
  code: string;
  name: string;
};

export type AcademicDiscipline = DisciplineCatalogItem & {
  description: string;
};

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
  const researchTopics = splitResearchProfileValues(profile.researchTopics, 2).join("、");
  const researchSummary = researchTopics
    ? ` · 研究主题 ${researchTopics}`
    : "";
  return `性别 ${profile.gender} · 年龄 ${profile.age} · 学段 ${profile.stage}${researchSummary}`;
}

export function formatAcademicResearchProfile(profile: AcademicProfile) {
  const disciplines = profile.disciplines ?? [];
  return disciplines.length > 0
    ? disciplines
        .map((discipline) =>
          `${discipline.categoryName} · ${discipline.name}${
            discipline.description ? `（${discipline.description}）` : ""
          }`
        )
        .join("、")
    : "未设置";
}

export function buildAcademicProfileAssistantSummary(profile: AcademicProfile) {
  const disciplines = profile.disciplines ?? [];
  const parts = [
    profile.stage !== "未设置" ? `研究阶段：${profile.stage}` : "",
    disciplines.length > 0
      ? `研究学科：${formatAcademicResearchProfile(profile)}`
      : "",
    profile.researchTopics ? `研究主题：${profile.researchTopics}` : "",
    profile.researchMethods ? `常用方法：${profile.researchMethods}` : ""
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("；") : undefined;
}

export function splitResearchProfileValues(value: string, limit = 12) {
  const items = value
    .split(/[\n,，;；、]+/)
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
      ...(profile.disciplines ?? []).flatMap((discipline) => [discipline.name, discipline.description]),
      ...splitResearchProfileValues(profile.researchTopics)
    ].filter(Boolean).slice(0, 12)
  };
  return Object.values(researchProfile).some((items) => items.length > 0)
    ? researchProfile
    : undefined;
}

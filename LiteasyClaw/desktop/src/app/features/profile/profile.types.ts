export type AcademicProfile = {
  age: string;
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
    topics: splitResearchProfileValues(profile.researchTopics)
  };
  return Object.values(researchProfile).some((items) => items.length > 0)
    ? researchProfile
    : undefined;
}

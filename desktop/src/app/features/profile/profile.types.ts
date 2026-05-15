export type AcademicProfile = {
  age: string;
  gender: string;
  stage: string;
};

export const defaultAcademicProfile: AcademicProfile = {
  age: "未设置",
  gender: "未设置",
  stage: "未设置"
};

export function formatAcademicProfile(profile: AcademicProfile) {
  return `性别 ${profile.gender} · 年龄 ${profile.age} · 学段 ${profile.stage}`;
}

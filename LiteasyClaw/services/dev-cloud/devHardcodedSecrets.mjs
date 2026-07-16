// Development-only hardcoded defaults for isolated local feature work.
// Keep production startup on `npm start`; use `npm run start:hardcoded` only in the closed dev environment.

export const hardcodedDevSecrets = {
  defaultProvider: "openai",
  fakeAnswerPrefix: "实验默认回复",
  forceLocalFakeModel: true,
  openaiApiBaseUrl: "https://api.openai.com/v1",
  openaiApiKey: "sk-ebe0f6ae24f5748435d15f278c2cdde2f0b81eb97172c7ffa109faffa84db98a"
};

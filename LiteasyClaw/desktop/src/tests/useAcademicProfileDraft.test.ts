import { act, renderHook } from "@testing-library/react";
import { useAcademicProfileDraft } from "../app/features/profile/useAcademicProfileDraft";
import {
  defaultAcademicProfile,
  toRecommendationResearchProfile
} from "../app/features/profile/profile.types";

test("saves only the academic archive fields and clears retired research-detail fields", () => {
  const onSave = vi.fn();
  const { result } = renderHook(() =>
    useAcademicProfileDraft({ academicProfile: defaultAcademicProfile, onSave })
  );

  act(() => result.current.updateDraftProfile("stage", "博士研究生"));
  act(() => result.current.updateDraftProfile("disciplines", [{
    categoryCode: "08",
    categoryName: "工学",
    code: "0812",
    description: " 自然语言处理与信息检索 ",
    name: "计算机科学与技术"
  }]));
  act(() => result.current.updateDraftProfile("researchTopics", " 神经检索，向量数据库\n神经检索"));
  act(() => result.current.updateDraftProfile("researchMethods", "混合检索; 对比学习"));
  act(() => result.current.updateDraftProfile("researchDatasets", "MS MARCO、BEIR"));
  act(() => result.current.updateDraftProfile("preferredLanguages", "中文, English"));
  act(() => result.current.saveAcademicProfile());

  expect(onSave).toHaveBeenCalledWith({
    ...defaultAcademicProfile,
    disciplines: [{
      categoryCode: "08",
      categoryName: "工学",
      code: "0812",
      description: "自然语言处理与信息检索",
      name: "计算机科学与技术"
    }],
    preferredLanguages: "",
    researchDatasets: "",
    researchMethods: "",
    researchTopics: "",
    stage: "博士研究生"
  });
});

test("converts academic research interests to bounded recommendation fields", () => {
  expect(toRecommendationResearchProfile({
    ...defaultAcademicProfile,
    disciplines: [{ categoryCode: "08", categoryName: "工学", code: "0812", description: "", name: "信息检索" }],
    preferredLanguages: "中文, English, 中文",
    researchDatasets: "BEIR",
    researchMethods: "hybrid retrieval",
    researchTopics: "neural retrieval"
  })).toEqual({
    datasets: ["BEIR"],
    languages: ["中文", "English"],
    methods: ["hybrid retrieval"],
    topics: ["neural retrieval", "信息检索"]
  });
});

test("syncs draft when the saved academic profile changes", () => {
  const onSave = vi.fn();
  const profile = {
    ...defaultAcademicProfile,
    disciplines: [{
      categoryCode: "04",
      categoryName: "教育学",
      code: "0401",
      description: "学习分析",
      name: "教育学"
    }],
    stage: "博士研究生"
  };
  const { result, rerender } = renderHook(
    ({ academicProfile }) => useAcademicProfileDraft({ academicProfile, onSave }),
    { initialProps: { academicProfile: profile } }
  );

  expect(result.current.draftProfile).toEqual(profile);
  rerender({ academicProfile: defaultAcademicProfile });
  expect(result.current.draftProfile).toEqual(defaultAcademicProfile);
});

import { act, renderHook } from "@testing-library/react";
import { useAcademicProfileDraft } from "../app/features/profile/useAcademicProfileDraft";
import {
  defaultAcademicProfile,
  toRecommendationResearchProfile
} from "../app/features/profile/profile.types";

test("normalizes and saves editable academic profile drafts", () => {
  const onSave = vi.fn();
  const { result } = renderHook(() =>
    useAcademicProfileDraft({
      academicProfile: defaultAcademicProfile,
      onSave
    })
  );

  act(() => result.current.updateDraftProfile("gender", "女"));
  act(() => result.current.updateDraftProfile("age", " 28 "));
  act(() => result.current.updateDraftProfile("stage", "博士研究生"));
  act(() => result.current.updateDraftProfile("researchTopics", " 神经检索，向量数据库\n神经检索 "));
  act(() => result.current.updateDraftProfile("researchMethods", "混合检索; 对比学习"));
  act(() => result.current.updateDraftProfile("researchDatasets", "MS MARCO、BEIR"));
  act(() => result.current.updateDraftProfile("preferredLanguages", "中文, English"));
  act(() => result.current.saveAcademicProfile());

  expect(onSave).toHaveBeenCalledWith({
    age: "28",
    disciplines: [],
    gender: "女",
    preferredLanguages: "中文、English",
    researchDatasets: "MS MARCO、BEIR",
    researchMethods: "混合检索、对比学习",
    researchTopics: "神经检索、向量数据库",
    stage: "博士研究生"
  });
});

test("converts research interests to bounded recommendation fields without demographics", () => {
  expect(toRecommendationResearchProfile({
    ...defaultAcademicProfile,
    age: "28",
    gender: "女",
    preferredLanguages: "中文, English, 中文",
    researchDatasets: "BEIR",
    researchMethods: "hybrid retrieval",
    researchTopics: "neural retrieval"
  })).toEqual({
    datasets: ["BEIR"],
    languages: ["中文", "English"],
    methods: ["hybrid retrieval"],
    topics: ["neural retrieval"]
  });
});

test("syncs draft when the saved academic profile changes", () => {
  const onSave = vi.fn();
  const { result, rerender } = renderHook(
    ({ academicProfile }) =>
      useAcademicProfileDraft({
        academicProfile,
        onSave
      }),
    { initialProps: { academicProfile: {
      ...defaultAcademicProfile,
      age: "28",
      gender: "女",
      stage: "博士研究生"
    } } }
  );

  expect(result.current.draftProfile).toEqual({
    ...defaultAcademicProfile,
    age: "28",
    gender: "女",
    stage: "博士研究生"
  });

  rerender({ academicProfile: defaultAcademicProfile });

  expect(result.current.draftProfile).toEqual(defaultAcademicProfile);
  expect(result.current.visibleAge).toBe("");
});

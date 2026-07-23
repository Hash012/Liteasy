import { act, renderHook } from "@testing-library/react";
import { useAcademicProfileDraft } from "../app/features/profile/useAcademicProfileDraft";
import { defaultAcademicProfile } from "../app/features/profile/profile.types";

test("normalizes and saves editable academic profile drafts", () => {
  const onSave = vi.fn();
  const { result } = renderHook(() =>
    useAcademicProfileDraft({
      academicProfile: defaultAcademicProfile,
      onSave
    })
  );

  act(() => result.current.updateDraftProfile("stage", "博士研究生"));
  act(() => result.current.updateDraftProfile("disciplines", [{
    categoryCode: "08",
    categoryName: "工学",
    code: "0812",
    description: " 自然语言处理与信息检索 ",
    name: "计算机科学与技术"
  }]));
  act(() => result.current.saveAcademicProfile());

  expect(onSave).toHaveBeenCalledWith({
    disciplines: [{
      categoryCode: "08",
      categoryName: "工学",
      code: "0812",
      description: "自然语言处理与信息检索",
      name: "计算机科学与技术"
    }],
    stage: "博士研究生"
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
    {
      initialProps: {
        academicProfile: {
          disciplines: [{
            categoryCode: "04",
            categoryName: "教育学",
            code: "0401",
            description: "学习分析",
            name: "教育学"
          }],
          stage: "博士研究生"
        }
      }
    }
  );

  expect(result.current.draftProfile).toEqual({
    disciplines: [{
      categoryCode: "04",
      categoryName: "教育学",
      code: "0401",
      description: "学习分析",
      name: "教育学"
    }],
    stage: "博士研究生"
  });

  rerender({ academicProfile: defaultAcademicProfile });

  expect(result.current.draftProfile).toEqual(defaultAcademicProfile);
});

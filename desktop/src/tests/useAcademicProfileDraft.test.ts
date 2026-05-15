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

  act(() => result.current.updateDraftProfile("gender", "女"));
  act(() => result.current.updateDraftProfile("age", " 28 "));
  act(() => result.current.updateDraftProfile("stage", "博士研究生"));
  act(() => result.current.saveAcademicProfile());

  expect(onSave).toHaveBeenCalledWith({
    age: "28",
    gender: "女",
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
    { initialProps: { academicProfile: { age: "28", gender: "女", stage: "博士研究生" } } }
  );

  expect(result.current.draftProfile).toEqual({ age: "28", gender: "女", stage: "博士研究生" });

  rerender({ academicProfile: defaultAcademicProfile });

  expect(result.current.draftProfile).toEqual(defaultAcademicProfile);
  expect(result.current.visibleAge).toBe("");
});

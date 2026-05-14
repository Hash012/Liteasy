import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useProfileActions } from "../app/features/profile/useProfileActions";

describe("useProfileActions", () => {
  test("tracks academic archive and profile sampling state", () => {
    const { result } = renderHook(() => useProfileActions());

    expect(result.current.academicArchiveOpen).toBe(false);
    expect(result.current.profileSamplingEnabled).toBe(false);
    expect(result.current.profileClearMessage).toBeUndefined();

    act(() => result.current.openAcademicArchive());
    expect(result.current.academicArchiveOpen).toBe(true);

    act(() => result.current.closeAcademicArchive());
    expect(result.current.academicArchiveOpen).toBe(false);

    act(() => result.current.toggleProfileSampling());
    expect(result.current.profileSamplingEnabled).toBe(true);

    act(() => result.current.toggleProfileSampling());
    expect(result.current.profileSamplingEnabled).toBe(false);
    expect(result.current.profileClearMessage).toBeUndefined();
  });

  test("requires confirmation before clearing the profile and resets sampling", () => {
    const { result } = renderHook(() => useProfileActions());

    act(() => result.current.toggleProfileSampling());
    expect(result.current.profileSamplingEnabled).toBe(true);

    act(() => result.current.openClearProfileConfirm());
    expect(result.current.clearProfileConfirmOpen).toBe(true);

    act(() => result.current.closeClearProfileConfirm());
    expect(result.current.clearProfileConfirmOpen).toBe(false);
    expect(result.current.profileSamplingEnabled).toBe(true);

    act(() => result.current.openClearProfileConfirm());
    act(() => result.current.clearUserProfile());

    expect(result.current.clearProfileConfirmOpen).toBe(false);
    expect(result.current.profileSamplingEnabled).toBe(false);
    expect(result.current.profileClearMessage).toBe("用户画像已清空，基础身份信息已保留。");
  });
});

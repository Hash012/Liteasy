import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useProfileActions } from "../app/features/profile/useProfileActions";

describe("useProfileActions", () => {
  test("tracks academic archive state and requests profile sampling changes", () => {
    const onProfileSamplingChanged = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useProfileActions({
          onProfileSamplingChanged,
          profileSamplingEnabled: enabled
        }),
      { initialProps: { enabled: false } }
    );

    expect(result.current.academicArchiveOpen).toBe(false);
    expect(result.current.profileSamplingEnabled).toBe(false);
    expect(result.current.profileClearMessage).toBeUndefined();

    act(() => result.current.openAcademicArchive());
    expect(result.current.academicArchiveOpen).toBe(true);

    act(() => result.current.closeAcademicArchive());
    expect(result.current.academicArchiveOpen).toBe(false);

    act(() => result.current.toggleProfileSampling());
    expect(onProfileSamplingChanged).toHaveBeenLastCalledWith(true);

    rerender({ enabled: true });
    expect(result.current.profileSamplingEnabled).toBe(true);

    act(() => result.current.toggleProfileSampling());
    expect(onProfileSamplingChanged).toHaveBeenLastCalledWith(false);
  });

  test("requires confirmation before clearing the profile and resets sampling", () => {
    const onProfileSamplingChanged = vi.fn();
    const { result } = renderHook(() =>
      useProfileActions({
        onProfileSamplingChanged,
        profileSamplingEnabled: true
      })
    );

    expect(result.current.profileSamplingEnabled).toBe(true);

    act(() => result.current.openClearProfileConfirm());
    expect(result.current.clearProfileConfirmOpen).toBe(true);

    act(() => result.current.closeClearProfileConfirm());
    expect(result.current.clearProfileConfirmOpen).toBe(false);
    expect(result.current.profileSamplingEnabled).toBe(true);

    act(() => result.current.openClearProfileConfirm());
    act(() => result.current.clearUserProfile());

    expect(result.current.clearProfileConfirmOpen).toBe(false);
    expect(onProfileSamplingChanged).toHaveBeenLastCalledWith(false);
    expect(result.current.profileClearMessage).toBe("用户画像已清空，基础身份信息已保留。");
  });

  test("stores editable academic profile configuration and clears it with confirmation", () => {
    const onProfileSamplingChanged = vi.fn();
    const { result } = renderHook(() =>
      useProfileActions({
        onProfileSamplingChanged,
        profileSamplingEnabled: true
      })
    );

    expect(result.current.academicProfile).toEqual({ age: "未设置", gender: "未设置", stage: "未设置" });

    act(() =>
      result.current.updateAcademicProfile({
        age: "28",
        gender: "女",
        stage: "博士研究生"
      })
    );

    expect(result.current.academicProfile).toEqual({ age: "28", gender: "女", stage: "博士研究生" });
    expect(result.current.profileClearMessage).toBe("画像配置已更新。");

    act(() => result.current.openClearProfileConfirm());
    act(() => result.current.clearUserProfile());

    expect(result.current.academicProfile).toEqual({ age: "未设置", gender: "未设置", stage: "未设置" });
    expect(onProfileSamplingChanged).toHaveBeenLastCalledWith(false);
  });

});

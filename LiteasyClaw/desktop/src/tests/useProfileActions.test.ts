import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useProfileActions } from "../app/features/profile/useProfileActions";
import { defaultAcademicProfile } from "../app/features/profile/profile.types";

beforeEach(() => {
  window.localStorage.clear();
});

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

    expect(result.current.academicProfile).toEqual(defaultAcademicProfile);

    act(() =>
      result.current.updateAcademicProfile({
        ...defaultAcademicProfile,
        age: "28",
        gender: "女",
        researchTopics: "神经信息检索",
        stage: "博士研究生"
      })
    );

    expect(result.current.academicProfile).toEqual({
      ...defaultAcademicProfile,
      age: "28",
      gender: "女",
      researchTopics: "神经信息检索",
      stage: "博士研究生"
    });
    expect(result.current.profileClearMessage).toBe("画像配置已更新。");

    act(() => result.current.openClearProfileConfirm());
    act(() => result.current.clearUserProfile());

    expect(result.current.academicProfile).toEqual(defaultAcademicProfile);
    expect(onProfileSamplingChanged).toHaveBeenLastCalledWith(false);
  });

  test("restores the device-local research profile across hook instances", () => {
    const first = renderHook(() => useProfileActions());
    act(() => first.result.current.updateAcademicProfile({
      ...defaultAcademicProfile,
      preferredLanguages: "中文、English",
      researchMethods: "混合检索",
      researchTopics: "神经信息检索"
    }));
    first.unmount();

    const restored = renderHook(() => useProfileActions());
    expect(restored.result.current.academicProfile.researchTopics).toBe("神经信息检索");
    expect(restored.result.current.academicProfile.researchMethods).toBe("混合检索");
    expect(restored.result.current.academicProfile.preferredLanguages).toBe("中文、English");
  });

});

import { act, renderHook, waitFor } from "@testing-library/react";
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

  test("requires confirmation before clearing the profile and resets sampling", async () => {
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
    await act(() => result.current.clearUserProfile());

    expect(result.current.clearProfileConfirmOpen).toBe(false);
    expect(onProfileSamplingChanged).toHaveBeenLastCalledWith(false);
    expect(result.current.profileClearMessage).toBe("已清空本机学术档案。");
  });

  test("stores editable academic profile configuration and clears it with confirmation", async () => {
    const onProfileSamplingChanged = vi.fn();
    const { result } = renderHook(() =>
      useProfileActions({
        onProfileSamplingChanged,
        profileSamplingEnabled: true
      })
    );

    expect(result.current.academicProfile).toEqual(defaultAcademicProfile);

    await act(() =>
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
    expect(result.current.profileClearMessage).toBe("学术档案已保存到本机。");

    act(() => result.current.openClearProfileConfirm());
    await act(() => result.current.clearUserProfile());

    expect(result.current.academicProfile).toEqual(defaultAcademicProfile);
    expect(onProfileSamplingChanged).toHaveBeenLastCalledWith(false);
  });

  test("restores the device-local research profile across hook instances", async () => {
    const first = renderHook(() => useProfileActions());
    await act(() => first.result.current.updateAcademicProfile({
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

  test("ignores a profile response that arrives after switching accounts", async () => {
    let resolveFirst: ((value: { json: () => Promise<unknown>; ok: boolean; status: number }) => void) | undefined;
    const firstResponse = new Promise<{ json: () => Promise<unknown>; ok: boolean; status: number }>(
      (resolve) => {
        resolveFirst = resolve;
      }
    );
    const snapshots = {
      "session-a": {
        assistantSummary: "A 的关注",
        personalizationVersion: 3,
        profile: { disciplines: [], profileVersion: 1, stage: "本科生" }
      },
      "session-b": {
        assistantSummary: "B 的关注",
        personalizationVersion: 8,
        profile: { disciplines: [], profileVersion: 2, stage: "博士研究生" }
      }
    };
    const transport = vi.fn(({ body }: { body: string }) => {
      const { sessionId } = JSON.parse(body) as { sessionId: keyof typeof snapshots };
      if (sessionId === "session-a") {
        return firstResponse;
      }
      return Promise.resolve({
        json: async () => snapshots[sessionId],
        ok: true,
        status: 200
      });
    });
    const account = (sessionId: string) => ({
      email: `${sessionId}@example.com`,
      expiresAt: "2027-01-01T00:00:00Z",
      name: sessionId,
      sessionId
    });
    const { result, rerender } = renderHook(
      ({ sessionId }) => useProfileActions({
        accountSession: account(sessionId),
        controlPlaneEndpoint: "http://control-plane.test",
        profileSamplingEnabled: true,
        transport
      }),
      { initialProps: { sessionId: "session-a" } }
    );

    rerender({ sessionId: "session-b" });
    await waitFor(() => expect(result.current.personalizationVersion).toBe(8));

    await act(async () => {
      resolveFirst?.({
        json: async () => snapshots["session-a"],
        ok: true,
        status: 200
      });
      await firstResponse;
    });

    expect(result.current.academicProfile.stage).toBe("博士研究生");
    expect(result.current.assistantProfileSummary).toContain("B 的关注");
    expect(result.current.assistantProfileSummary).not.toContain("A 的关注");
  });

  test("does not send behavior signals while profile sampling is disabled", async () => {
    const transport = vi.fn(async () => ({
      json: async () => ({
        personalizationVersion: 0,
        profile: { disciplines: [], profileVersion: 0, stage: "未设置" }
      }),
      ok: true,
      status: 200
    }));
    const { result } = renderHook(() => useProfileActions({
      accountSession: {
        email: "reader@example.com",
        expiresAt: "2027-01-01T00:00:00Z",
        name: "Reader",
        sessionId: "reader-session"
      },
      controlPlaneEndpoint: "http://control-plane.test",
      profileSamplingEnabled: false,
      transport
    }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    await act(() => result.current.recordPersonalizationSignal({
      kind: "paper_opened",
      title: "神经信息检索"
    }));

    expect(transport.mock.calls.some(([request]) => request.url.endsWith("/v1/personalization/signal")))
      .toBe(false);
  });

});

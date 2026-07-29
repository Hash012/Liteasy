import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AccountSession } from "../app/features/account/account.types";
import { defaultAcademicProfile } from "../app/features/profile/profile.types";
import { useProfileActions } from "../app/features/profile/useProfileActions";

const accountSession: AccountSession = {
  email: "researcher@liteasy.dev",
  expiresAt: "2026-05-15T09:30:00Z",
  membershipTier: "pro",
  name: "Liteasy Researcher",
  sessionId: "demo-session-1"
};

beforeEach(() => window.localStorage.clear());

describe("useProfileActions", () => {
  test("opens and closes the academic archive", () => {
    const { result } = renderHook(() => useProfileActions());
    expect(result.current.academicArchiveOpen).toBe(false);
    act(() => result.current.openAcademicArchive());
    expect(result.current.academicArchiveOpen).toBe(true);
    act(() => result.current.closeAcademicArchive());
    expect(result.current.academicArchiveOpen).toBe(false);
  });

  test("stores a locally editable academic profile and clears it after confirmation", () => {
    const { result } = renderHook(() => useProfileActions());
    const profile = {
      ...defaultAcademicProfile,
      disciplines: [{
        categoryCode: "08",
        categoryName: "工学",
        code: "0812",
        description: "自然语言处理",
        name: "计算机科学与技术"
      }],
      researchTopics: "神经信息检索",
      stage: "博士研究生"
    };

    act(() => result.current.updateAcademicProfile(profile));
    expect(result.current.academicProfile).toEqual(profile);
    expect(result.current.assistantProfileSummary).toContain("研究学科");
    expect(result.current.profileClearMessage).toBe("学术档案已更新。");

    act(() => result.current.openClearProfileConfirm());
    act(() => result.current.clearUserProfile());
    expect(result.current.clearProfileConfirmOpen).toBe(false);
    expect(result.current.academicProfile).toEqual(defaultAcademicProfile);
    expect(result.current.profileClearMessage).toBe("学术档案已清空。");
  });

  test("syncs academic profile and signals without exposing a profile toggle", async () => {
    const savedProfile = {
      disciplines: [{
        categoryCode: "08",
        categoryName: "工学",
        code: "0812",
        description: "信息检索",
        name: "计算机科学与技术"
      }],
      stage: "博士研究生"
    };
    const requests: Array<{ body: Record<string, unknown>; url: string }> = [];
    const transport = async (request: { body: string; url: string }) => {
      requests.push({ body: JSON.parse(request.body), url: request.url });
      const profile = request.url.endsWith("/get")
        ? { disciplines: [], profileVersion: 0, stage: "未设置" }
        : { ...savedProfile, profileVersion: 1 };
      return {
        json: async () => ({
          ...(request.url.endsWith("/signal") ? { assistantSummary: "近期产品内关注：causal retrieval" } : {}),
          personalizationVersion: requests.length - 1,
          profile
        }),
        ok: true,
        status: 200
      };
    };
    const { result } = renderHook(() => useProfileActions({
      accountSession,
      controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
      transport
    }));

    await waitFor(() => expect(requests[0]?.url).toContain("/v1/profile/get"));
    const nextProfile = { ...defaultAcademicProfile, ...savedProfile, researchTopics: "causal retrieval" };
    await act(async () => { await result.current.updateAcademicProfile(nextProfile); });
    expect(requests[1].body).toEqual({ profile: nextProfile, sessionId: accountSession.sessionId });
    expect(result.current.academicProfile.researchTopics).toBe("causal retrieval");

    await act(async () => {
      await result.current.recordPersonalizationSignal({ kind: "paper_opened", title: "Causal retrieval" });
    });
    expect(result.current.assistantProfileSummary).toContain("causal retrieval");
    expect(result.current).not.toHaveProperty("profileSamplingEnabled");
  });

  test("restores the device-local academic archive across hook instances", () => {
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
  });
});

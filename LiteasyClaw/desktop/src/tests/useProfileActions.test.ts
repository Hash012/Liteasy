import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { AccountSession } from "../app/features/account/account.types";
import { useProfileActions } from "../app/features/profile/useProfileActions";

const accountSession: AccountSession = {
  email: "researcher@liteasy.dev",
  expiresAt: "2026-05-15T09:30:00Z",
  membershipTier: "pro",
  name: "Liteasy Researcher",
  sessionId: "demo-session-1"
};

describe("useProfileActions", () => {
  test("opens and closes the academic archive without a profile enable switch", () => {
    const { result } = renderHook(() => useProfileActions());

    expect(result.current.academicArchiveOpen).toBe(false);
    expect(result.current.profileClearMessage).toBeUndefined();

    act(() => result.current.openAcademicArchive());
    expect(result.current.academicArchiveOpen).toBe(true);

    act(() => result.current.closeAcademicArchive());
    expect(result.current.academicArchiveOpen).toBe(false);
    expect(result.current).not.toHaveProperty("toggleProfileSampling");
  });

  test("requires confirmation before clearing the profile", () => {
    const { result } = renderHook(() => useProfileActions());

    act(() => result.current.openClearProfileConfirm());
    expect(result.current.clearProfileConfirmOpen).toBe(true);

    act(() => result.current.closeClearProfileConfirm());
    expect(result.current.clearProfileConfirmOpen).toBe(false);

    act(() => result.current.openClearProfileConfirm());
    act(() => result.current.clearUserProfile());

    expect(result.current.clearProfileConfirmOpen).toBe(false);
    expect(result.current.profileClearMessage).toBe("已清空学科、补充说明和研究阶段。");
  });

  test("stores editable academic profile configuration and clears it with confirmation", () => {
    const { result } = renderHook(() => useProfileActions());

    expect(result.current.academicProfile).toEqual({
      disciplines: [],
      stage: "未设置"
    });

    act(() =>
      result.current.updateAcademicProfile({
        disciplines: [{
          categoryCode: "08",
          categoryName: "工学",
          code: "0812",
          description: "自然语言处理",
          name: "计算机科学与技术"
        }],
        stage: "博士研究生"
      })
    );

    expect(result.current.academicProfile).toEqual({
      disciplines: [{
        categoryCode: "08",
        categoryName: "工学",
        code: "0812",
        description: "自然语言处理",
        name: "计算机科学与技术"
      }],
      stage: "博士研究生"
    });
    expect(result.current.assistantProfileSummary).toContain("研究学科：工学 · 计算机科学与技术（自然语言处理）");
    expect(result.current.profileClearMessage).toBe("学术档案已更新。");

    act(() => result.current.openClearProfileConfirm());
    act(() => result.current.clearUserProfile());

    expect(result.current.academicProfile).toEqual({
      disciplines: [],
      stage: "未设置"
    });
  });

  test("saves the two user-managed fields and applies aggregate personalization without exposing it", async () => {
    const savedProfile = {
      disciplines: [
        {
          categoryCode: "08",
          categoryName: "工学",
          code: "0812",
          description: "信息检索",
          name: "计算机科学与技术"
        }
      ],
      stage: "博士研究生"
    };
    const requests: Array<{ body: Record<string, unknown>; url: string }> = [];
    const transport = async (request: { body: string; url: string }) => {
      requests.push({ body: JSON.parse(request.body), url: request.url });
      const payload = request.url.endsWith("/get")
        ? {
            personalizationVersion: 0,
            profile: { disciplines: [], profileVersion: 0, stage: "未设置" }
          }
        : request.url.endsWith("/save")
          ? {
              personalizationVersion: 1,
              profile: { ...savedProfile, profileVersion: 1 }
            }
          : request.url.endsWith("/signal")
            ? {
                assistantSummary: "近期产品内关注：causal retrieval",
                personalizationVersion: 2,
                profile: { ...savedProfile, profileVersion: 1 }
              }
            : {
                personalizationVersion: 3,
                profile: { disciplines: [], profileVersion: 0, stage: "未设置" }
              };
      return {
        json: async () => payload,
        ok: true,
        status: 200
      };
    };

    const { result } = renderHook(() =>
      useProfileActions({
        accountSession,
        controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
        transport
      })
    );

    await waitFor(() => {
      expect(result.current.personalizationVersion).toBe(0);
    });

    await act(async () => {
      await result.current.updateAcademicProfile(savedProfile);
    });
    expect(result.current.academicProfile).toEqual(savedProfile);
    expect(result.current.personalizationVersion).toBe(1);
    expect(requests[1].url).toContain("/v1/profile/save");
    expect(requests[1].body).toEqual({ profile: savedProfile, sessionId: accountSession.sessionId });

    await act(async () => {
      await result.current.recordPersonalizationSignal({
        kind: "paper_opened",
        title: "Causal retrieval"
      });
    });
    expect(result.current.assistantProfileSummary).toContain("近期产品内关注：causal retrieval");
    expect(result.current).not.toHaveProperty("personalizationTerms");

    await act(async () => {
      await result.current.clearUserProfile();
    });
    expect(result.current.academicProfile).toEqual({ disciplines: [], stage: "未设置" });
    expect(result.current.personalizationVersion).toBe(3);
    expect(requests[3].url).toContain("/v1/profile/clear");
  });

});

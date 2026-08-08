import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useRegisteredWorkspaceActions } from "../app/features/workspace/useRegisteredWorkspaceActions";

describe("useRegisteredWorkspaceActions", () => {
  test("runs selected-set import through the registered action boundary", async () => {
    const importSelectedSet = vi.fn(() => "已将当前选中文献集交给 AI 流程，正在执行解析与索引。");
    const onAnalysisHint = vi.fn();
    const { result } = renderHook(() =>
      useRegisteredWorkspaceActions({
        importSelectedSet,
        onAnalysisHint,
        startArtifactAnalysis: vi.fn()
      })
    );

    await act(async () => {
      await result.current.handleImportSelectedSet();
    });

    expect(importSelectedSet).toHaveBeenCalledTimes(1);
    expect(onAnalysisHint).toHaveBeenLastCalledWith("已将当前选中文献集交给 AI 流程，正在执行解析与索引。");
  });

  test("runs artifact analysis through the registered action boundary", async () => {
    const startArtifactAnalysis = vi.fn(() => "当前选中文献集已导入，正在按指定 AI 分析启动。");
    const onAnalysisHint = vi.fn();
    const { result } = renderHook(() =>
      useRegisteredWorkspaceActions({
        importSelectedSet: vi.fn(),
        onAnalysisHint,
        startArtifactAnalysis
      })
    );

    await act(async () => {
      await result.current.handleDirectAnalysis("tree");
    });

    expect(startArtifactAnalysis).toHaveBeenCalledWith("tree");
    expect(onAnalysisHint).toHaveBeenLastCalledWith("当前选中文献集已导入，正在按指定 AI 分析启动。");
  });
});

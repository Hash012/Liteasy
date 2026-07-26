import { describe, expect, test } from "vitest";
import {
  getAssistantErrorMessage,
  getAuditVerdictLabel,
  getModeHint,
  getModeLabel,
  getSelectedSetReadyMessage
} from "../app/features/assistant/assistantPresentation";

describe("assistant presentation helpers", () => {
  test("formats mode labels and guidance text", () => {
    expect(getModeLabel("explain")).toBe("名词解释");
    expect(getModeLabel("command")).toBe("命令");
    expect(getModeLabel("qa")).toBe("问答");
    expect(getModeHint("command")).toContain("输入 / 开始软件命令");
    expect(getModeHint("qa")).toContain("PDF 选区");
  });

  test("explains why the selected document set is not ready", () => {
    expect(
      getSelectedSetReadyMessage({ importedCount: 0, selectedCount: 0, selectionLocked: false })
    ).toBe("请先在左栏勾选文件，形成选中文献集。");
    expect(
      getSelectedSetReadyMessage({ importedCount: 0, selectedCount: 2, selectionLocked: false })
    ).toBe("请先锁定选中文献集，再使用右栏自然语言分支能力。");
    expect(
      getSelectedSetReadyMessage({ importedCount: 1, selectedCount: 2, selectionLocked: true })
    ).toBe("请先将当前选中文献集导入 AI 流程，再进行问答或解释。");
    expect(
      getSelectedSetReadyMessage({ importedCount: 2, selectedCount: 2, selectionLocked: true })
    ).toBeNull();
  });

  test("formats assistant errors and audit verdict labels", () => {
    expect(getAssistantErrorMessage(new Error("upstream 502"))).toContain("详细信息：upstream 502");
    expect(getAssistantErrorMessage("offline")).toBe("模型服务暂时不可用，请检查当前模型端点配置或稍后重试。");
    expect(getAuditVerdictLabel("pass")).toBe("通过");
    expect(getAuditVerdictLabel("review")).toBe("需复核");
    expect(getAuditVerdictLabel("fail")).toBe("未通过");
  });
});

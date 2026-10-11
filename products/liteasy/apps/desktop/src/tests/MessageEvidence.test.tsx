import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { MessageEvidence } from "../app/features/evidence/components/MessageEvidence";
import { evidenceReportFromAnchors } from "../app/features/evidence/evidenceAdapters";
import { paperAnchorFromEvidence } from "../app/features/paper-anchors/paperAnchorEntity";

vi.mock("../app/features/objects/objectWorkbenchPort", () => ({ useObjectWorkbench: () => ({ scopeId: "user:test" }) }));

test("does not reopen a rejected PDF source through an injected same-scope asset path", () => {
  const anchor = paperAnchorFromEvidence({ id: "e1", paperId: "p1", page: 2, quote: "actual quote" });
  const evidenceReport = evidenceReportFromAnchors({ id: "r1", answer: "answer", anchors: [anchor] });
  evidenceReport.sources[0].resourcePath = "liteasy://objects/other?scope=user%3Atest";
  evidenceReport.sources[0].scopeId = "user:test";
  const open = vi.fn();
  render(<MessageEvidence message={{ id: "r1", role: "assistant", content: "answer", paperAnchors: [anchor], evidenceReport }} papers={[]} onOpenAsset={open} />);
  fireEvent.click(screen.getByRole("button", { name: /0 篇来源/ }));
  fireEvent.click(screen.getByRole("button", { name: "查看全部证据" }));
  expect(screen.queryByText("actual quote")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "打开原文" })).not.toBeInTheDocument();
  expect(open).not.toHaveBeenCalled();
});

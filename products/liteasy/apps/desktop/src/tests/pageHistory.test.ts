import { describe, expect, test, vi } from "vitest";
import { movePageSelection, pageOptions, recordPageVisit } from "../app/features/workspace/pageHistory";
import type { WorkspaceSurface } from "../app/features/workspace/workspaceShell.types";
const surface = (id: string): WorkspaceSurface => ({ id, region: "main", active: true, title: id, onActivate: vi.fn() });
describe("page history", () => {
  test("retains bounded recent locators without page bodies or callbacks and distinguishes reader files", () => {
    let visits = recordPageVisit([], { ...surface("reader"), pageKey: "file-a", pageTarget: { kind: "reading", id: "a" } }, 1);
    visits = recordPageVisit(visits, { ...surface("reader"), pageKey: "file-b", pageTarget: { kind: "reading", id: "b" } }, 2);
    expect(visits.map((item) => item.key)).toEqual(["file-b", "file-a"]);
    expect(visits[0]).not.toHaveProperty("onActivate");
    visits = recordPageVisit(visits, { ...surface("reader"), pageKey: "file-a" }, 3);
    expect(visits.map((item) => item.visitedAt)).toEqual([3, 2]);
    for (let index = 0; index < 105; index++) visits = recordPageVisit(visits, surface(`p${index}`), index + 4);
    expect(visits).toHaveLength(100);
    expect(visits[0].key).toBe("p104");
  });
  test("keeps closed history but excludes it from active pages and uses moved live surface metadata", () => {
    const old = { ...surface("paper"), pageTarget: { kind: "paper" as const, id: "p" } };
    const visits = recordPageVisit(recordPageVisit([], old), surface("temporary"));
    expect(pageOptions([], visits, "active")).toEqual([]);
    expect(pageOptions([], visits, "history").map(({ open, available }) => [open, available])).toEqual([[false, false], [false, true]]);
    expect(pageOptions([{ ...old, region: "left", title: "新标题" }], visits, "history")[1]).toMatchObject({ region: "left", title: "新标题", open: true });
  });
  test("moves through wrapped rows and incomplete final rows", () => {
    expect(movePageSelection(0, "ArrowLeft", 7, 3)).toBe(6);
    expect(movePageSelection(2, "ArrowRight", 7, 3)).toBe(3);
    expect(movePageSelection(1, "ArrowDown", 7, 3)).toBe(4);
    expect(movePageSelection(5, "ArrowDown", 7, 3)).toBe(6);
    expect(movePageSelection(4, "ArrowUp", 7, 3)).toBe(1);
    expect(movePageSelection(4, "Home", 7, 3)).toBe(0);
    expect(movePageSelection(0, "End", 7, 3)).toBe(6);
    expect(movePageSelection(0, "ArrowDown", 0, 0)).toBe(0);
  });
});

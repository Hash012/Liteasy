import { describe, expect, test } from "vitest";
import { parseLibraryDragPayload } from "../app/features/library/libraryDragPayload";

describe("parseLibraryDragPayload", () => {
  test("parses a Liteasy drag payload from the requested MIME type", () => {
    const dataTransfer = {
      getData(type: string) {
        return type === "application/liteasy-library-item" ? JSON.stringify({ id: "p1", title: "Paper" }) : "";
      }
    };

    expect(parseLibraryDragPayload<{ id: string; title: string }>(dataTransfer, "application/liteasy-library-item")).toEqual({
      id: "p1",
      title: "Paper"
    });
  });

  test("returns null for missing or malformed payloads", () => {
    expect(parseLibraryDragPayload({ getData: () => "" }, "application/liteasy-library-item")).toBeNull();
    expect(parseLibraryDragPayload({ getData: () => "not-json" }, "application/liteasy-library-item")).toBeNull();
  });
});

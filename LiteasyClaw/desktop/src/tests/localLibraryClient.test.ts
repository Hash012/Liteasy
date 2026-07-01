import { expect, test } from "vitest";
import { createLocalLibraryClient } from "../app/features/library/localLibraryClient";

test("normalizes a local library snapshot returned from the runtime seam", async () => {
  const client = createLocalLibraryClient(async () => ({
    entries: [
      {
        id: "paper-1",
        path: "/tmp/LiteasyLibrary/papers/attention-is-all-you-need.pdf",
        title: "Attention Is All You Need"
      }
    ],
    rootPath: "/tmp/LiteasyLibrary"
  }));

  const snapshot = await client();

  expect(snapshot.rootPath).toBe("/tmp/LiteasyLibrary");
  expect(snapshot.entries[0].title).toBe("Attention Is All You Need");
});

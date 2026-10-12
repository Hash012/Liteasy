import { expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createObjectStorage } from "../app/features/objects/objectStorage";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));

test("desktop board export reads its layout through one scope-bound native transaction", async () => {
  const rows = [{ key: "head/board", version: "r1", value: { revision: "r1" } }];
  vi.mocked(invoke).mockResolvedValueOnce(rows);
  const storage = createObjectStorage("account-a", () => "account-a");
  const prefixes = ["head/board", "placement/board/", "edge/board/", "block-presentation/board/"];
  expect(await storage.snapshot!(prefixes)).toEqual(rows);
  expect(invoke).toHaveBeenCalledWith("object_store_snapshot", { scope: "account-a", prefixes });
});

test("account switch while the native snapshot is pending invalidates the result", async () => {
  let active = "account-a";
  vi.mocked(invoke).mockImplementationOnce(async () => { active = "account-b"; return []; });
  const storage = createObjectStorage("account-a", () => active);
  await expect(storage.snapshot!(["head/board"])).rejects.toThrow("账号已切换");
});

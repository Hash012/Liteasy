import { expect, test } from "vitest";
import { displayPath } from "../app/features/resource-filesystem/displayPath";

test.each([
  [String.raw`\\?\D:\TJM\Documents\le\LiteasyData\local-library\library`, String.raw`D:\TJM\Documents\le\LiteasyData\local-library\library`],
  [String.raw`\\?\UNC\server\share\论文.pdf`, String.raw`\\server\share\论文.pdf`],
  [String.raw`\\server\share\论文.pdf`, String.raw`\\server\share\论文.pdf`],
  ["/home/user/LiteasyData", "/home/user/LiteasyData"],
  ["liteasy://objects/item?scope=user", "liteasy://objects/item?scope=user"],
  [String.raw`\\?\Volume{test}\path`, String.raw`\\?\Volume{test}\path`],
])("displays %s without changing unrelated path syntax", (path, expected) => {
  expect(displayPath(path)).toBe(expected);
});

test("cleans already slash-normalized Windows drive and UNC display paths", () => {
  expect(displayPath("//?/D:/Library/trial")).toBe("D:/Library/trial");
  expect(displayPath("//?/UNC/server/share/trial")).toBe("//server/share/trial");
});

import { expect, test } from "vitest";
import { resolveMineruImageSource } from "../app/features/import/mineruImageSources";

const figure = {
  alt: "Diagram",
  dataUrl: "data:image/png;base64,AA==",
  id: "figure-1",
  page: 1,
  sourcePath: "document/output/images/diagram.png"
};

test("resolves normalized MinerU relative image paths to the current document data URL", () => {
  expect(resolveMineruImageSource("./images/diagram.png?cache=1", [figure])).toBe(figure.dataUrl);
  expect(resolveMineruImageSource("diagram.png", [figure])).toBe(figure.dataUrl);
  expect(resolveMineruImageSource("data:image/webp;base64,BB==", [figure])).toBe("data:image/webp;base64,BB==");
});

test("fails closed for missing or ambiguous relative MinerU images", () => {
  const duplicate = { ...figure, dataUrl: "data:image/png;base64,BB==", id: "figure-2", sourcePath: "other/diagram.png" };

  expect(resolveMineruImageSource("missing.png", [figure])).toBeUndefined();
  expect(resolveMineruImageSource("diagram.png", [figure, duplicate])).toBeUndefined();
  expect(resolveMineruImageSource("file:///tmp/diagram.png", [figure])).toBeUndefined();
  expect(resolveMineruImageSource("https://tracker.example/pixel.png", [figure])).toBeUndefined();
  expect(resolveMineruImageSource("http://127.0.0.1:8791/admin.png", [figure])).toBeUndefined();
});

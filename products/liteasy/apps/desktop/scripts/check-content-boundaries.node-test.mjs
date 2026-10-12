import { test } from "node:test";
import assert from "node:assert/strict";
import { contentBoundaryViolations } from "./check-content-boundaries.mjs";
const path = "features/evidence/BadBody.tsx";
test("rejects local pipelines, raw body JSX and evidence truncation using syntax nodes", () => {
  for (const source of ['import R from "react-markdown";', '<blockquote>{passage.quote}</blockquote>', '<MarkdownContent value={body} />', 'read.text.slice(0, 4000)', '<div dangerouslySetInnerHTML={{ __html: body }} />']) assert.equal(contentBoundaryViolations(source, path).length, 1);
});
test("permits literal titles, typed views, comments and the host profile", () => {
  for (const source of ['<strong>{source.title}</strong>', '<ContentView content={fragment} />', '// read.text.slice(0, 4000)']) assert.deepEqual(contentBoundaryViolations(source, path), []);
  assert.deepEqual(contentBoundaryViolations('import R from "rehype-raw";', "features/markdown/contentProfile.ts"), []);
});

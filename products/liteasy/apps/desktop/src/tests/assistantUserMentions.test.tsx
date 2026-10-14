import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { AssistantUserMarkdown } from "../app/features/assistant/AssistantUserMarkdown";
import type { AssistantContextToken } from "../app/features/assistant/assistant.types";
function token(text: string, start: number): AssistantContextToken {
  return { id: "source", label: text, kind: "object", prompt: "", contextRefs: [{ objectId: "source", revision: "fixed" }], mentions: [{ id: "mention", start, end: start + text.length, text }] };
}
test.each(["A *B* paper", "`code` paper", "A \\*B\\* &amp;", "$x+y$ paper", "[X](http://x)"])("keeps explicit mention title literal: %s", (title) => {
  const prefix = "**问题**： ";
  const { container } = render(<AssistantUserMarkdown value={`${prefix}${title} 请解释。`} tokens={[token(title, prefix.length)]} />);
  const mention = container.querySelector(".assistant-inline-context");
  expect(mention).not.toBeNull();
  expect(mention).toHaveTextContent(title);
  expect(mention?.querySelector("em,code,a,.katex")).toBeNull();
  expect(container.querySelector("strong")?.textContent).toBe("问题");
});
test("preserves code examples and never exposes internal placeholders", () => {
  const title = "A *B* paper", value = `\`${title}\``;
  const { container } = render(<AssistantUserMarkdown value={value} tokens={[token(title, 1)]} />);
  expect(container.querySelector("code")).toHaveTextContent(title);
  expect(container.querySelector(".assistant-inline-context")).toBeNull();
});

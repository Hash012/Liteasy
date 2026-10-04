import { expect, test } from "vitest";
import { conversationWindow, readConversationHistory } from "../app/features/assistant/conversationWindow";
import { contextTokens } from "../app/features/context/contextSelection";

test("keeps more than twelve complete turns when they fit the configured window", () => {
  const turns = Array.from({ length: 30 }, (_, index) => ({ user: `用户的第${index}条约束`, assistant: `答复${index}` }));
  const result = conversationWindow(turns, 8000);
  expect(result).toMatchObject({ totalTurns: 30, includedTurns: 30, compactedTurns: 0 });
  expect(JSON.parse(result.text)[0].user).toBe(turns[0].user);
});

test("bounds the projection without mutating or losing the searchable original", () => {
  const original = "prefix ".repeat(2000) + "EXACT-OLD-DECISION-73" + " ending".repeat(2000);
  const turns = [{ user: "早期约束", assistant: original }, { user: "继续", assistant: "新的答复" }];
  const result = conversationWindow(turns, 600, "早期约束");
  expect(contextTokens(result.text)).toBeLessThanOrEqual(600);
  expect(result.compactedTurns).toBe(1);
  expect(result.text).toContain("摘录");
  expect(turns[0].assistant).toBe(original);
  const read = readConversationHistory(turns, "EXACT-OLD-DECISION", 13500);
  expect(read.text).toContain("EXACT-OLD-DECISION-73");
  expect(read.nextOffset).toBeGreaterThan(read.offset);
  expect(readConversationHistory(turns, "nonexistent", 0).matchedTurns).toBe(0);
  expect(contextTokens(conversationWindow(turns, 10).text)).toBeLessThanOrEqual(10);
});

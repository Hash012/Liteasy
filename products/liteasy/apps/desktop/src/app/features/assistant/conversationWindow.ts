import { contextTokens } from "../context/contextSelection";
import type { AssistantConversationTurn } from "./assistantConversationContext";

export type ConversationWindowInfo = { totalTurns: number; includedTurns: number; compactedTurns: number };

function fitText(value: string, budget: number) {
  if (contextTokens(value) <= budget) return value;
  let low = 0, high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (contextTokens(value.slice(0, middle)) <= budget) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low);
}

/** Full turns stay in session storage. This is a bounded projection for one request. */
export function conversationWindow(turns: readonly AssistantConversationTurn[], maxTokens: number, query = "") {
  const budget = Math.max(0, Math.floor(maxTokens));
  const records = turns.map((turn, index) => ({ turn: index + 1, ...turn }));
  const full = records.length ? JSON.stringify(records) : "";
  if (contextTokens(full) <= budget) return { text: full, totalTurns: turns.length, includedTurns: turns.length, compactedTurns: 0 };
  // Preserve recent complete turns first, with space reserved for earlier requests.
  const recent: typeof records = [];
  let recentTokens = 0;
  for (let index = records.length - 1; index >= 0; index--) {
    const cost = contextTokens(JSON.stringify(records[index])) + 1;
    if (recentTokens + cost > budget * 0.75) break;
    recent.unshift(records[index]); recentTokens += cost;
  }
  const older = records.slice(0, records.length - recent.length);
  const terms = query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const ranked = [...older].sort((a, b) => {
    const score = (turn: typeof a) => terms.reduce((sum, term) => sum + Number(`${turn.user} ${turn.assistant}`.toLocaleLowerCase().includes(term)), 0);
    return score(b) - score(a) || a.turn - b.turn;
  });
  const excerpts: Array<{ turn: number; excerpt: string }> = [];
  const encode = () => JSON.stringify({ notice: "较早轮次仅为摘录，并非完整记忆；可用 history 按关键词和 offset 读取本会话原文。", earlier: excerpts, recent });
  // These are explicitly labelled verbatim excerpts, never fabricated summaries.
  for (const turn of ranked) {
    const entry = { turn: turn.turn, excerpt: fitText(`用户：${turn.user}\n助手：${turn.assistant}`, 160) };
    excerpts.push(entry);
    if (contextTokens(encode()) > budget) { excerpts.pop(); break; }
  }
  let text = encode();
  if (contextTokens(text) > budget) text = fitText("本轮历史窗口空间不足。可用 history 检索本会话完整记录。", budget);
  return { text, totalTurns: turns.length, includedTurns: recent.length, compactedTurns: older.length };
}

/** Search and paginate only the current session's completed, stored turns. */
export function readConversationHistory(turns: readonly AssistantConversationTurn[], query: string, offset: number, maxCharacters = 6000) {
  const needle = query.trim().toLocaleLowerCase();
  const matches = turns.map((turn, index) => ({ ...turn, index: index + 1 })).filter((turn) =>
    !needle || `${turn.user}\n${turn.assistant}`.toLocaleLowerCase().includes(needle));
  const source = matches.map((turn) => `第 ${turn.index} 轮\n用户：${turn.user}\n助手：${turn.assistant}`).join("\n\n");
  const start = Math.max(0, Math.min(Math.floor(offset), source.length));
  const text = source.slice(start, start + maxCharacters);
  return { matchedTurns: matches.length, totalTurns: turns.length, offset: start, text, totalCharacters: source.length,
    ...(start + text.length < source.length ? { nextOffset: start + text.length } : {}) };
}

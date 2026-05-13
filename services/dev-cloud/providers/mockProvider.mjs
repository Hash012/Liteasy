function extractQuestion(prompt) {
  const matchedQuestion = String(prompt ?? "").match(/问题：([^\n]+)/);
  if (matchedQuestion?.[1]) {
    return matchedQuestion[1].trim();
  }

  return String(prompt ?? "").trim();
}

export async function generateMockAnswer(input) {
  return `开发云回答：${extractQuestion(input.prompt)}`;
}

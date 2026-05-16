import type { GenerateAnswerInput } from "./modelGateway";

function extractQuestion(prompt: string) {
  const matchedQuestion = prompt.match(/问题：([^\n]+)/);
  if (matchedQuestion?.[1]) {
    return matchedQuestion[1].trim();
  }

  return prompt.trim();
}

export async function generateCloudProxyAnswer(input: GenerateAnswerInput) {
  return `云端回答：${extractQuestion(input.prompt)}`;
}

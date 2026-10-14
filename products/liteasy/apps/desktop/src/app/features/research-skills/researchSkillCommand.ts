import { listResearchSkills } from "./researchSkillCatalog";
/** Only a leading, complete command is executable; math, escapes and code remain text. */
export function parseResearchSkillCommand(input: string) {
  const match = /^\s*\$([a-z][a-z-]*)(?:[ \t\r\n]+|$)/.exec(input);
  if (!match) return undefined;
  const skill = listResearchSkills().find(skill => skill.id === match[1]);
  if (!skill?.ref || !skill.adapter) throw new Error(`科研方法“${match[1]}”不可用，请从 $ 菜单选择`);
  return { skill, prompt: input.slice(match[0].length) };
}

export function isResearchSkillPosition(input: string, position: number) {
  let fence = "", inline = "", math = "";
  for (const line of input.slice(0, position).split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
      continue;
    }
    if (fence) continue;
    for (const token of line.matchAll(/\\.|`+|\${1,2}/g)) {
      const value = token[0];
      if (value.startsWith("\\")) continue;
      if (value.startsWith("`")) { if (!inline) inline = value; else if (inline === value) inline = ""; }
      else if (!inline) { if (!math) math = value; else if (math === value) math = ""; }
    }
  }
  return !fence && !inline && !math;
}

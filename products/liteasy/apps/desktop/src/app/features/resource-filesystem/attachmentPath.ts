export function relativeImagePath(documentPath: string, imagePath: string) {
  const decoded = decodeURIComponent(imagePath.split("#")[0]);
  if (/^[a-z][a-z0-9+.-]*:|^[\/\\]/i.test(decoded) || decoded.includes("\\")) throw new Error("图片必须位于已连接目录中。");
  const parts = documentPath.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) throw new Error("图片超出已连接目录。"); parts.pop(); }
    else parts.push(part);
  }
  return parts.join("/");
}

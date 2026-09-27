/** Keep the development model boundary aligned with the desktop's bounded local image contract. */
export function validateModelImages(images) {
  if (images === undefined) return;
  const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
  if (!Array.isArray(images) || images.length > 12) fail("每轮最多读取 12 张图片。", 413);
  let total = 0;
  for (const image of images) {
    if (typeof image?.base64 === "string" && image.base64.length > Math.ceil(5 * 1024 * 1024 / 3) * 4)
      fail("本轮图片总量超过 5 MB，请分批添加。", 413);
    if (!image || typeof image !== "object" || Array.isArray(image) ||
      Object.keys(image).some((key) => !["mediaType", "base64", "label"].includes(key)) ||
      !/^image\/(png|jpeg|gif|webp)$/.test(image.mediaType) || typeof image.label !== "string" || image.label.length > 1000 || image.label.includes("\u0000") ||
      typeof image.base64 !== "string" || !image.base64 || image.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)) {
      fail("图片数据无效，请重新添加。");
    }
    const bytes = Buffer.from(image.base64, "base64");
    total += bytes.length;
    if (bytes.length > 5 * 1024 * 1024 || total > 5 * 1024 * 1024) fail("本轮图片总量超过 5 MB，请分批添加。", 413);
    if (bytes.length < 12 || bytes.toString("base64") !== image.base64) fail("图片编码无效。");
    const valid = image.mediaType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : image.mediaType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : image.mediaType === "image/gif" ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!valid) fail("图片内容与格式不一致。");
  }
}

/** Upstream diagnostics may echo the submitted request; do not expose inline image bytes. */
export function describeModelImageError(error, images) {
  let message = error instanceof Error ? error.message : "模型图片请求失败。";
  message = message.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+/gi, "[图片数据已隐藏]");
  for (const image of Array.isArray(images) ? images : []) {
    if (typeof image?.base64 === "string" && image.base64.length >= 16) message = message.split(image.base64).join("[图片数据已隐藏]");
  }
  return message.slice(0, 2000);
}

export function validateModelImageProvider(body) {
  validateModelImages(body.images);
  if (body.images?.length && (body.provider ?? "openai") !== "openai") {
    const error = new Error("当前模型连接不支持图片，请选择支持视觉的 OpenAI 连接。");
    error.status = 400;
    throw error;
  }
}

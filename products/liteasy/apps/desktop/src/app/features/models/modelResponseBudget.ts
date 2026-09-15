/** UTF-8 byte limits; cloud completion frames may repeat the entire validated answer. */
export const MODEL_RESPONSE_LIMITS = {
  answerBytes: 2 * 1024 * 1024,
  reasoningBytes: 256 * 1024,
  sseFrameBytes: 1024 * 1024,
  ndjsonFrameBytes: 4 * 1024 * 1024,
  wireBytes: 16 * 1024 * 1024,
  frames: 50_000
} as const;

const encoder = new TextEncoder();
export function modelTextBytes(value: string) {
  // UTF-8 cannot be shorter than the UTF-16 code-unit count; reject giant strings
  // before allocating an equally giant encoder buffer for a custom transport.
  assertModelResponseSize(value.length, MODEL_RESPONSE_LIMITS.wireBytes, "响应数据");
  return encoder.encode(value).byteLength;
}

export function assertModelResponseSize(bytes: number, maximum: number, part: string) {
  if (bytes > maximum) throw new Error(`模型${part}超出本次接收预算，已停止生成。请缩小生成范围后重试。`);
}

export function createModelTextBudget() {
  let answerBytes = 0;
  let reasoningBytes = 0;
  return {
    answer(delta: string) {
      answerBytes += modelTextBytes(delta);
      assertModelResponseSize(answerBytes, MODEL_RESPONSE_LIMITS.answerBytes, "正文");
    },
    reasoning(delta: string) {
      reasoningBytes += modelTextBytes(delta);
      assertModelResponseSize(reasoningBytes, MODEL_RESPONSE_LIMITS.reasoningBytes, "推理内容");
    }
  };
}

/** Decode bounded segments so one large transport chunk cannot inflate the residual buffer. */
export function createBoundedModelFrames(separator: RegExp, maximum: number, onFrame: (frame: string) => void) {
  const decoder = new TextDecoder();
  let buffer = "";
  let bufferBytes = 0;
  let receivedBytes = 0;
  let frames = 0;
  const consumeFrame = (frame: string) => {
    assertModelResponseSize(modelTextBytes(frame), maximum, "响应帧");
    assertModelResponseSize(++frames, MODEL_RESPONSE_LIMITS.frames, "响应事件数量");
    onFrame(frame);
  };
  const consumeText = (text: string) => {
    buffer += text;
    bufferBytes += modelTextBytes(text);
    let match: RegExpExecArray | null;
    while ((match = separator.exec(buffer))) {
      const raw = buffer.slice(0, match.index);
      bufferBytes -= modelTextBytes(raw + match[0]);
      buffer = buffer.slice(match.index + match[0].length);
      consumeFrame(raw);
    }
    assertModelResponseSize(bufferBytes, maximum, "未完成响应帧");
  };
  return {
    push(chunk: Uint8Array) {
      receivedBytes += chunk.byteLength;
      assertModelResponseSize(receivedBytes, MODEL_RESPONSE_LIMITS.wireBytes, "响应数据");
      for (let offset = 0; offset < chunk.length; offset += 65_536) {
        consumeText(decoder.decode(chunk.subarray(offset, offset + 65_536), { stream: true }));
      }
    },
    finish() {
      consumeText(decoder.decode());
      if (buffer.trim()) consumeFrame(buffer);
      buffer = "";
      bufferBytes = 0;
    }
  };
}

/** Abort pending reads explicitly as custom transports need not be fetch-backed. */
export async function readBoundedModelStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: Uint8Array) => boolean | void,
  signal?: AbortSignal
) {
  if (signal?.aborted) {
    await body.cancel(signal.reason).catch(() => undefined);
    signal.throwIfAborted();
  }
  const reader = body.getReader();
  let done = false;
  let receivedBytes = 0;
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const result = await reader.read();
      signal?.throwIfAborted();
      done = result.done;
      if (done) break;
      receivedBytes += result.value!.byteLength;
      assertModelResponseSize(receivedBytes, MODEL_RESPONSE_LIMITS.wireBytes, "响应数据");
      if (onChunk(result.value!) === false) break;
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (!done) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function readBoundedModelText(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  await readBoundedModelStream(body, (chunk) => { chunks.push(decoder.decode(chunk, { stream: true })); }, signal);
  chunks.push(decoder.decode());
  return chunks.join("");
}

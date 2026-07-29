import { ensureReadableStreamAsyncIterator } from "../app/features/pdf/pdfStreamCompatibility";

class LegacyReadableStream<T> {
  private readonly values: T[];

  constructor(values: T[]) {
    this.values = [...values];
  }

  getReader() {
    return {
      cancel: async () => undefined,
      read: async () => this.values.length > 0
        ? { done: false as const, value: this.values.shift()! }
        : { done: true as const, value: undefined },
      releaseLock: () => undefined
    };
  }
}

test("adds async iteration for WebKit readable streams that only expose getReader", async () => {
  expect(ensureReadableStreamAsyncIterator(
    LegacyReadableStream as unknown as typeof ReadableStream
  )).toBe(true);
  const stream = new LegacyReadableStream(["first", "second"]);
  const values: string[] = [];

  for await (const value of stream as LegacyReadableStream<string> & AsyncIterable<string>) {
    values.push(value);
  }

  expect(values).toEqual(["first", "second"]);
  expect(ensureReadableStreamAsyncIterator(
    LegacyReadableStream as unknown as typeof ReadableStream
  )).toBe(false);
});

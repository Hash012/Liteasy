type ReadableStreamWithOptionalAsyncIterator = ReadableStream<unknown> & {
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
};

export function ensureReadableStreamAsyncIterator(
  StreamConstructor: typeof ReadableStream | undefined = globalThis.ReadableStream
) {
  if (!StreamConstructor) {
    return false;
  }
  const prototype = StreamConstructor.prototype as ReadableStreamWithOptionalAsyncIterator;
  if (typeof prototype[Symbol.asyncIterator] === "function") {
    return false;
  }

  Object.defineProperty(prototype, Symbol.asyncIterator, {
    configurable: true,
    value: function asyncIterator<T>(this: ReadableStream<T>) {
      const reader = this.getReader();
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          reader.releaseLock();
        }
      };
      const iterator: AsyncIterator<T> & AsyncIterable<T> = {
        async next() {
          const result = await reader.read();
          if (result.done) {
            release();
          }
          return result;
        },
        async return() {
          try {
            await reader.cancel();
          } finally {
            release();
          }
          return { done: true, value: undefined as T };
        },
        [Symbol.asyncIterator]() {
          return this;
        }
      };
      return iterator;
    },
    writable: true
  });
  return true;
}

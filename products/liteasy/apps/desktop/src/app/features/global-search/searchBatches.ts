/** Bound concurrent disk/IPC reads and retain source order without loading a whole vault at once. */
export function* searchBatches<T>(items: readonly T[], size = 6) {
  for (let offset = 0; offset < items.length; offset += size) yield items.slice(offset, offset + size);
}
export async function mapSearchBatch<T, R>(items: readonly T[], signal: AbortSignal, read: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  for (const batch of searchBatches(items)) {
    signal.throwIfAborted();
    // Wait for every in-flight read before allowing the next refresh to write.
    const values = await Promise.allSettled(batch.map(read));
    signal.throwIfAborted();
    for (const value of values) {
      if (value.status === "rejected") throw value.reason;
      result.push(value.value);
    }
  }
  return result;
}

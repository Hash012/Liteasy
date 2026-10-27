type PositionWriter = { flushAndWait(): Promise<void> };
const writers = new Set<PositionWriter>();

/** Keep closing tabs registered until their final asynchronous write has settled. */
export function registerPdfPositionWriter(writer: PositionWriter) {
  writers.add(writer);
  return () => {
    void writer.flushAndWait().finally(() => writers.delete(writer)).catch(() => {});
  };
}

export async function flushPdfReaderPositions() {
  const results = await Promise.allSettled([...writers].map(writer => writer.flushAndWait()));
  const failure = results.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

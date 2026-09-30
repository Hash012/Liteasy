import { zipSync } from "fflate";

globalThis.onmessage = event => {
  try {
    const data = zipSync(event.data as Record<string, Uint8Array>, { level: 1 });
    // The generated file runs only as a dedicated extension worker.
    (globalThis.postMessage as (message: unknown, transfer: Transferable[]) => void)({ data }, [data.buffer]);
  } catch (error) {
    globalThis.postMessage({ error: String((error as Error).message || error) });
  }
};

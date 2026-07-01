type DataTransferLike = {
  getData(type: string): string;
};

export function parseLibraryDragPayload<T>(dataTransfer: DataTransferLike, mimeType: string): T | null {
  const rawPayload = dataTransfer.getData(mimeType);
  if (!rawPayload) {
    return null;
  }

  try {
    return JSON.parse(rawPayload) as T;
  } catch {
    return null;
  }
}

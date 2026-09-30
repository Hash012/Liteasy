import { BrowserLibraryRepository } from "./browserLibraryRepository";
import { type LibraryItem, type LibraryRepository, type ImportResource, maxImportBytes, validateImport } from "./library.types";
import { decodeBytes, encodeBytes, hasNativeHost, nativeRequest } from "../../platform/native";

class NativeLibraryRepository implements LibraryRepository {
  list(scope: string) { return nativeRequest<LibraryItem[]>("list", { scope }); }
  update(scope: string, item: LibraryItem) { return nativeRequest<LibraryItem>("update", { scope, item }); }
  readRecord<T>(scope: string, key: string) { return nativeRequest<T | undefined>("readRecord", { scope, key }); }
  writeRecord<T>(scope: string, key: string, value: T) { return nativeRequest<void>("writeRecord", { scope, key, value }); }

  async importResource(scope: string, input: ImportResource) {
    validateImport(input);
    const { bytes, ...metadata } = input;
    if (!bytes) return nativeRequest<LibraryItem>("importText", { scope, input: metadata });
    const transfer = await nativeRequest<string>("beginImport", { scope, input: metadata, size: bytes.length });
    try {
      for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
        await nativeRequest("appendImport", { scope, transfer, offset, data: encodeBytes(bytes.subarray(offset, offset + 256 * 1024)) });
      }
      return await nativeRequest<LibraryItem>("finishImport", { scope, transfer });
    } catch (error) {
      await nativeRequest("cancelImport", { scope, transfer }).catch(() => {});
      throw error;
    }
  }

  async readBytes(scope: string, id: string) {
    const { size } = await nativeRequest<{ size: number }>("fileInfo", { scope, id });
    if (!Number.isSafeInteger(size) || size < 0 || size > maxImportBytes) throw new Error("文件大小无效。");
    const bytes = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += 256 * 1024) {
      const chunk = decodeBytes(await nativeRequest<string>("readFile", { scope, id, offset, length: Math.min(256 * 1024, size - offset) }));
      if (chunk.length !== Math.min(256 * 1024, size - offset)) throw new Error("文件读取不完整，请重新下载。");
      bytes.set(chunk, offset);
    }
    return bytes;
  }
}

let repository: LibraryRepository | undefined;
export function libraryRepository() {
  return repository ??= hasNativeHost() ? new NativeLibraryRepository() : new BrowserLibraryRepository();
}

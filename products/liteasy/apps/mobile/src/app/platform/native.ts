import { invoke, isTauri } from "@tauri-apps/api/core";

export const hasNativeHost = () => isTauri();

export async function nativeRequest<T>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
  const response = await invoke<{ value: T }>("mobile_dispatch", { request: { operation, ...input } });
  return response.value;
}

export function encodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

export function decodeBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

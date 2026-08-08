export const intuechoApiBaseUrl = import.meta.env.VITE_INTUECHO_API_URL ??
  (import.meta.env.DEV ? "http://127.0.0.1:4040" : window.location.origin);

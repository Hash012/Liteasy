type PdfFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isDirectBrowserPdfSource(sourcePath: string) {
  const normalized = sourcePath.trim().toLowerCase();
  return normalized.startsWith("blob:") ||
    normalized.startsWith("data:application/pdf");
}

async function readResponseBytes(response: Response, fallbackMessage: string) {
  if (!response.ok) {
    let message = `${fallbackMessage}：HTTP ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      message = payload.message ?? message;
    } catch {
      // Keep the transport-level error when the response is not JSON.
    }
    throw new Error(message);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadPdfBytesForImport(input: {
  devCloudEndpoint: string;
  fetchPdf?: PdfFetch;
  readTauriPdf: (sourcePath: string) => Promise<Uint8Array>;
  sourcePath: string;
  tauriAvailable: boolean;
}) {
  if (input.tauriAvailable) {
    return input.readTauriPdf(input.sourcePath);
  }

  const fetchPdf = input.fetchPdf ?? fetch;
  if (isDirectBrowserPdfSource(input.sourcePath)) {
    return readResponseBytes(await fetchPdf(input.sourcePath), "无法读取浏览器中的 PDF");
  }

  throw new Error("本地 PDF 只能由桌面宿主在已选择的文献库边界内读取。");
}

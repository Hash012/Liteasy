import { resizeContextThumbnail } from "../../../app/features/assistant/ContextAssetThumbnail";
import { createPreviewRequest, previewDiagnostics } from "../../../app/features/resource-links/previewRequest";
Object.assign(window, {
  async decodeThumbnail(url: string) {
    const request = createPreviewRequest();
    try {
      const thumbnail = await resizeContextThumbnail(url, request);
      const image = new Image(); image.src = thumbnail; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
      const pixel = Array.from(context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data);
      return { width: canvas.width, height: canvas.height, pixel, trace: previewDiagnostics() };
    } finally { request.dispose(); }
  },
});

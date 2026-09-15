import { MarkdownContent, markdownUrlTransform } from "../markdown/MarkdownContent";
import { isPdfTextBoxImages, type PdfTextBoxImages } from "./pdfTextBoxImages";

type PdfAnnotationMarkdownProps = {
  className?: string;
  emptyLabel?: string;
  value: string;
  images?: PdfTextBoxImages;
};

/** Annotation attachments are resolved from the current annotation only. */
export function PdfAnnotationMarkdown({
  className = "pdf-annotation-markdown", emptyLabel, value, images
}: PdfAnnotationMarkdownProps) {
  return (
    <MarkdownContent
      className={className}
      emptyLabel={emptyLabel}
      value={value}
      urlTransform={(url, key, node) => {
        if (key === "src" && url.startsWith("attachment:")) {
          const id = url.slice("attachment:".length);
          const image = images?.[id];
          return image && isPdfTextBoxImages({ [id]: image }) ? image : "";
        }
        return markdownUrlTransform(url, key, node);
      }}
    />
  );
}

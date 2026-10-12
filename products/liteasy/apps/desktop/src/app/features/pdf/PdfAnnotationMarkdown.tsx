import { ContentView } from "../markdown/ContentView";
import { legacyContent } from "../markdown/contentFragment";
import {  markdownUrlTransform } from "../markdown/MarkdownContent";
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
    <ContentView
      className={className}
      emptyLabel={emptyLabel}
      content={legacyContent(value)}
      urlTransform={pdfAnnotationUrlTransform(images)}
    />
  );
}

export function pdfAnnotationUrlTransform(images?: PdfTextBoxImages): typeof markdownUrlTransform {
  return (url, key, node) => {
    if (key === "src" && url.startsWith("attachment:")) {
      const id = url.slice("attachment:".length), image = images?.[id];
      return image && isPdfTextBoxImages({ [id]: image }) ? image : "";
    }
    return markdownUrlTransform(url, key, node);
  };
}

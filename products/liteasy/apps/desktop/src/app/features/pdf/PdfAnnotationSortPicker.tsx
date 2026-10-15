import { OptionPicker } from "../../shared/ui/productPrimitives";
import { pdfAnnotationSortLabels, type PdfAnnotationSort } from "./pdfAnnotationSort";

export function PdfAnnotationSortPicker({ value, onChange }: { value: PdfAnnotationSort; onChange(value: PdfAnnotationSort): void }) {
  return <OptionPicker aria-label="批注排序" density="compact" value={value} onValueChange={(value) => onChange(value as PdfAnnotationSort)}
    options={Object.entries(pdfAnnotationSortLabels).map(([value, label]) => ({ value, label }))} />;
}

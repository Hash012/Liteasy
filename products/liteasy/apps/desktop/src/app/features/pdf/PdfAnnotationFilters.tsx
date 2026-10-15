import { Button, Tooltip } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { OptionPicker } from "../../shared/ui/productPrimitives";
import type { PdfAnnotation, PdfAnnotationKind, PdfHighlightColor } from "./pdfAnnotationStorage";

export const pdfAnnotationKindLabels = { highlight: "高亮", underline: "划线", note: "便笺", text: "文本框", ink: "手绘" };
export const pdfAnnotationColorLabels = { yellow: "黄色", red: "红色", blue: "蓝色", green: "绿色", pink: "粉色" };
export type PdfAnnotationFacets = { kind: PdfAnnotationKind | "all"; color: PdfHighlightColor | "all" };
export const emptyPdfAnnotationFacets: PdfAnnotationFacets = { kind: "all", color: "all" };

export function matchesPdfAnnotationFacets(annotation: Pick<PdfAnnotation, "kind" | "color">, facets: PdfAnnotationFacets) {
  const color = annotation.kind === "highlight" ? annotation.color ?? "yellow"
    : annotation.kind === "underline" ? annotation.color ?? "blue" : undefined;
  return (facets.kind === "all" || annotation.kind === facets.kind) && (facets.color === "all" || color === facets.color);
}

export function PdfAnnotationFilters({ value, onChange }: { value: PdfAnnotationFacets; onChange(value: PdfAnnotationFacets): void }) {
  return <div className="pdf-annotation-facets" aria-label="批注类型与颜色筛选">
    <OptionPicker aria-label="筛选批注类型" density="compact" value={value.kind}
      onValueChange={(kind) => onChange({ ...value, kind: kind as PdfAnnotationFacets["kind"] })}
      options={[{ value: "all", label: "全部类型" }, ...Object.entries(pdfAnnotationKindLabels).map(([value, label]) => ({ value, label }))]} />
    <OptionPicker aria-label="筛选批注颜色" density="compact" value={value.color}
      onValueChange={(color) => onChange({ ...value, color: color as PdfAnnotationFacets["color"] })}
      options={[{ value: "all", label: "全部颜色" }, ...Object.entries(pdfAnnotationColorLabels).map(([value, label]) => ({ value, label }))]} />
    {value.kind !== "all" || value.color !== "all" ? <Tooltip content="清除类型与颜色筛选" relationship="description">
      <Button aria-label="清除类型与颜色筛选" size="small" appearance="subtle" icon={<DismissRegular />} onClick={() => onChange(emptyPdfAnnotationFacets)} />
    </Tooltip> : null}
  </div>;
}

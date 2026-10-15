import { Button, Tooltip } from "@fluentui/react-components";
import { CheckmarkRegular, DismissRegular } from "@fluentui/react-icons";
import { OptionPicker } from "../../shared/ui/productPrimitives";
import { pdfHighlightColors, type PdfAnnotation, type PdfAnnotationKind, type PdfHighlightColor } from "./pdfAnnotationStorage";
import { getHighlightColor, pdfAnnotationColorLabels } from "./pdfAnnotationAppearance";

export const pdfAnnotationKindLabels = { highlight: "高亮", underline: "划线", note: "便笺", text: "文本框", ink: "手绘" };
export type PdfAnnotationFacets = { kind: PdfAnnotationKind | "all"; color: PdfHighlightColor | "all" };
export const emptyPdfAnnotationFacets: PdfAnnotationFacets = { kind: "all", color: "all" };
type ColoredAnnotation = Pick<PdfAnnotation, "kind" | "color">;
function visibleColor(annotation: ColoredAnnotation) {
  return annotation.kind === "highlight" ? annotation.color ?? "yellow"
    : annotation.kind === "underline" ? annotation.color ?? "blue" : undefined;
}
export function matchesPdfAnnotationFacets(annotation: ColoredAnnotation, facets: PdfAnnotationFacets) {
  return (facets.kind === "all" || annotation.kind === facets.kind) && (facets.color === "all" || visibleColor(annotation) === facets.color);
}

export function PdfAnnotationFilters({ value, annotations, onChange }: {
  value: PdfAnnotationFacets; annotations: readonly ColoredAnnotation[]; onChange(value: PdfAnnotationFacets): void;
}) {
  const counts = new Map<PdfHighlightColor, number>();
  for (const annotation of annotations) {
    const color = visibleColor(annotation);
    if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  // Keep a selected color removable when its last annotation is deleted or recolored.
  const colors = pdfHighlightColors.filter((color) => counts.has(color) || value.color === color);
  return <div className="pdf-annotation-facets" aria-label="批注类型与颜色筛选">
    <OptionPicker aria-label="筛选批注类型" density="compact" value={value.kind}
      onValueChange={(kind) => onChange({ ...value, kind: kind as PdfAnnotationFacets["kind"] })}
      options={[{ value: "all", label: "全部类型" }, ...Object.entries(pdfAnnotationKindLabels).map(([value, label]) => ({ value, label }))]} />
    {colors.length ? <div className="pdf-annotation-color-filters" role="group" aria-label="按批注颜色筛选">
      {colors.map((color) => <Tooltip key={color} content={`${pdfAnnotationColorLabels[color]} · ${counts.get(color) ?? 0} 条批注；再次点击取消筛选`} relationship="description">
        <Button size="small" appearance="subtle" className="pdf-annotation-color-filter"
          aria-label={`筛选${pdfAnnotationColorLabels[color]}批注`} aria-pressed={value.color === color}
          onClick={() => onChange({ ...value, color: value.color === color ? "all" : color })}>
          <span className="pdf-annotation-filter-swatch" style={{ backgroundColor: getHighlightColor(color) }} aria-hidden="true">
            {value.color === color ? <CheckmarkRegular /> : null}
          </span><span>{pdfAnnotationColorLabels[color]}</span><span className="pdf-annotation-color-count">{counts.get(color) ?? 0}</span>
        </Button>
      </Tooltip>)}
    </div> : null}
    {value.kind !== "all" || value.color !== "all" ? <Tooltip content="清除类型与颜色筛选" relationship="description">
      <Button aria-label="清除类型与颜色筛选" size="small" appearance="subtle" icon={<DismissRegular />} onClick={() => onChange(emptyPdfAnnotationFacets)} />
    </Tooltip> : null}
  </div>;
}

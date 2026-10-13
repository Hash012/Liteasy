import { OptionPicker } from "../../shared/ui/productPrimitives";
import { LightbulbRegular } from "@fluentui/react-icons";
import { Field, Tooltip } from "@fluentui/react-components";
import type { RecommendationStyle } from "./recommendation.types";
import { isRecommendationStyle, recommendationStyles } from "./recommendationStyle";

type RecommendationStyleControlProps = {
  onChange?: (style: RecommendationStyle) => void;
  value: RecommendationStyle;
  compact?: boolean;
};

export function RecommendationStyleControl({ onChange, value, compact }: RecommendationStyleControlProps) {
  const select = (
      <OptionPicker aria-label="推荐风格" disabled={!onChange} density="compact" value={String(value ?? "")} onValueChange={nextValue => { if (isRecommendationStyle(nextValue)) onChange?.(nextValue); }} options={[...((Object.keys(recommendationStyles) as RecommendationStyle[]).map(style => ({ value: String(style), label: String(recommendationStyles[style].label) })))]} />
  );
  if (compact) return <Tooltip content="推荐风格" relationship="description"><div className="recommendation-style-control compact"><LightbulbRegular aria-hidden="true" />{select}</div></Tooltip>;
  return (
    <Field className={`recommendation-style-control${compact ? " compact" : ""}`} hint={compact ? undefined : recommendationStyles[value].description} label="推荐风格" size="small">
      <OptionPicker disabled={!onChange} onValueChange={nextValue => {
          if (isRecommendationStyle(nextValue)) onChange?.(nextValue);
        }} density="compact" title={recommendationStyles[value].description} value={String(value ?? "")} options={[...((Object.keys(recommendationStyles) as RecommendationStyle[]).map((style) => ({ value: String(style), label: String(recommendationStyles[style].label) })))]} />
    </Field>
  );
}

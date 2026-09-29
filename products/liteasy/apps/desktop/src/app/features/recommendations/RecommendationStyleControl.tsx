import { Field, Select } from "@fluentui/react-components";
import type { RecommendationStyle } from "./recommendation.types";
import { isRecommendationStyle, recommendationStyles } from "./recommendationStyle";

type RecommendationStyleControlProps = {
  onChange?: (style: RecommendationStyle) => void;
  value: RecommendationStyle;
  compact?: boolean;
};

export function RecommendationStyleControl({ onChange, value, compact }: RecommendationStyleControlProps) {
  return (
    <Field className={`recommendation-style-control${compact ? " compact" : ""}`} hint={compact ? undefined : recommendationStyles[value].description} label="推荐风格" size="small">
      <Select
        disabled={!onChange}
        onChange={(_event, data) => {
          if (isRecommendationStyle(data.value)) onChange?.(data.value);
        }}
        size="small"
        title={recommendationStyles[value].description}
        value={value}
      >
        {(Object.keys(recommendationStyles) as RecommendationStyle[]).map((style) => (
          <option key={style} value={style}>{recommendationStyles[style].label}</option>
        ))}
      </Select>
    </Field>
  );
}

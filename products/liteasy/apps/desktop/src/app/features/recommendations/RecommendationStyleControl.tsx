import { Field, Select } from "@fluentui/react-components";
import type { RecommendationStyle } from "./recommendation.types";
import { isRecommendationStyle, recommendationStyles } from "./recommendationStyle";

type RecommendationStyleControlProps = {
  onChange?: (style: RecommendationStyle) => void;
  value: RecommendationStyle;
};

export function RecommendationStyleControl({ onChange, value }: RecommendationStyleControlProps) {
  return (
    <Field className="recommendation-style-control" hint={recommendationStyles[value].description} label="推荐风格" size="small">
      <Select
        disabled={!onChange}
        onChange={(_event, data) => {
          if (isRecommendationStyle(data.value)) onChange?.(data.value);
        }}
        size="small"
        value={value}
      >
        {(Object.keys(recommendationStyles) as RecommendationStyle[]).map((style) => (
          <option key={style} value={style}>{recommendationStyles[style].label}</option>
        ))}
      </Select>
    </Field>
  );
}

import { LightbulbRegular } from "@fluentui/react-icons";
import { Field, Select, Tooltip } from "@fluentui/react-components";
import type { RecommendationStyle } from "./recommendation.types";
import { isRecommendationStyle, recommendationStyles } from "./recommendationStyle";

type RecommendationStyleControlProps = {
  onChange?: (style: RecommendationStyle) => void;
  value: RecommendationStyle;
  compact?: boolean;
};

export function RecommendationStyleControl({ onChange, value, compact }: RecommendationStyleControlProps) {
  const select = (
      <Select aria-label="推荐风格" disabled={!onChange} size="small" value={value} onChange={(_, data) => { if (isRecommendationStyle(data.value)) onChange?.(data.value); }}>
        {(Object.keys(recommendationStyles) as RecommendationStyle[]).map(style => <option key={style} value={style}>{recommendationStyles[style].label}</option>)}
      </Select>
  );
  if (compact) return <Tooltip content="推荐风格" relationship="description"><div className="recommendation-style-control compact"><LightbulbRegular aria-hidden="true" />{select}</div></Tooltip>;
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

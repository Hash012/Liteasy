import { Checkbox } from "@fluentui/react-components";
import type { AnnotationTarget, AnnotationVisibility } from "./community.types";
import { LiteratureTargetEditor } from "./LiteratureTargetEditor";

const visibilityLabels: Record<AnnotationVisibility, string> = {
  private: "仅自己",
  organization: "指定组织",
  mutual_followers: "仅互相关注",
  public: "公开"
};

type Props = {
  disabled?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onTargetsChange: (targets: AnnotationTarget[]) => void;
  publishAsAnnotation: boolean;
  targets: AnnotationTarget[];
  visibility: AnnotationVisibility;
};

export function ReplyPublicationFields({ disabled = false, onEnabledChange, onTargetsChange, publishAsAnnotation, targets, visibility }: Props) {
  return <section className="reply-publication-fields">
    <Checkbox
      checked={publishAsAnnotation}
      disabled={disabled}
      label="同时发布为独立批注"
      onChange={(_, data) => onEnabledChange(Boolean(data.checked))}
    />
    <p className="inherited-visibility">可见范围继承自原批注：{visibilityLabels[visibility]}</p>
    {publishAsAnnotation && <>
      <LiteratureTargetEditor required targets={targets} onChange={onTargetsChange} />
    </>}
  </section>;
}

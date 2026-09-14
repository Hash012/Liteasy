import { Tooltip } from "@fluentui/react-components";
import {
  ArrowSyncRegular,
  GlobeRegular,
  LockClosedRegular,
  WarningRegular,
} from "@fluentui/react-icons";

export function PdfAnnotationStatus({
  label,
  state,
  live,
}: {
  label: string;
  state: "private" | "public" | "pending" | "failed";
  live: boolean;
}) {
  const icon =
    state === "failed" ? (
      <WarningRegular />
    ) : state === "public" ? (
      <GlobeRegular />
    ) : state === "pending" ? (
      <ArrowSyncRegular />
    ) : (
      <LockClosedRegular />
    );
  return (
    <Tooltip content={label} relationship="description">
      <span
        aria-label={label}
        aria-live={live ? "polite" : undefined}
        className={`pdf-annotation-status-icon is-${state}`}
        role={live ? "status" : "img"}
      >
        {icon}
        {live ? (
          <span className="pdf-annotation-accessible-label">{label}</span>
        ) : null}
      </span>
    </Tooltip>
  );
}

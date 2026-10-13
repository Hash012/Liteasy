import type { HTMLAttributes } from "react";
import "./visuallyHidden.css";

/** An announcement remains in the accessibility tree without consuming layout. */
export function VisuallyHidden({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={`visually-hidden ${className}`} />;
}

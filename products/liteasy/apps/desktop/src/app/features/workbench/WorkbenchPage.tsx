import { SourceDisclosure } from "../../shared/ui/productPrimitives";
import type { ReactNode } from "react";
import "./workbenchPage.css";

/** Shared composition rules; document renderers keep their own typography. */
export function WorkbenchPageHeader({ title, description, actions, descriptionMode = "visible" }: { title: string; description?: string; actions?: ReactNode; descriptionMode?: "visible" | "details" }) {
  return <header className="workbench-page-header"><div><h1>{title}</h1>{description ? descriptionMode === "details" ? <SourceDisclosure summary={`关于${title}`}><p>{description}</p></SourceDisclosure> : <p>{description}</p> : null}</div>{actions ? <div className="workbench-page-actions">{actions}</div> : null}</header>;
}
export function WorkbenchEmptyState({ title, description, icon, actions, error = false }: { title: string; description: string; icon?: ReactNode; actions?: ReactNode; error?: boolean }) {
  return <div className="workbench-empty-state" role={error ? "alert" : "status"}>{icon}<h2>{title}</h2><p>{description}</p>{actions ? <div className="workbench-page-actions">{actions}</div> : null}</div>;
}
export function SettingRow({ title, description, children, descriptionMode = "visible" }: { title: string; description?: string; children: ReactNode; descriptionMode?: "visible" | "details" }) {
  return <div className="workbench-setting-row"><div><strong>{title}</strong>{description ? descriptionMode === "details" ? <SourceDisclosure summary={`关于${title}`}><p>{description}</p></SourceDisclosure> : <p>{description}</p> : null}</div><div className="workbench-setting-control">{children}</div></div>;
}

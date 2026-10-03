import { Button, Select } from "@fluentui/react-components";
import type { OrganizationChoice } from "@intuecho/contracts";
import { useEffect, useState } from "react";
import { communityApi } from "./communityApi";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onResolvedSelection: (choice: OrganizationChoice | undefined) => void;
};
const roleLabels = { owner: "负责人", admin: "管理员", member: "成员" };

export function OrganizationAudienceSelector({ value, onChange, onResolvedSelection }: Props) {
  const [organizations, setOrganizations] = useState<OrganizationChoice[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setState("loading");
    setOrganizations([]);
    void communityApi.organizationChoices().then((response) => {
      if (!current) return;
      setOrganizations(response.organizations);
      setState("ready");
    }, () => { if (current) setState("failed"); });
    return () => { current = false; };
  }, [attempt]);

  const selected = state === "ready" ? organizations.find((item) => item.organizationId === value && item.allowedActions.includes("comment")) : undefined;
  useEffect(() => { onResolvedSelection(selected); }, [selected, onResolvedSelection]);
  return <div className="organization-audience">
    <label>接收组织<Select value={value} disabled={state !== "ready"} onChange={(_, data) => onChange(data.value)}>
      <option value="">{state === "loading" ? "正在确认组织权限" : "请选择组织"}</option>
      {value && !organizations.some((item) => item.organizationId === value) && <option value={value} disabled>原组织暂不可用</option>}
      {organizations.map((item) => <option key={item.organizationId} value={item.organizationId} disabled={!item.allowedActions.includes("comment")}>
        {item.name} · {roleLabels[item.role]}{item.allowedActions.includes("comment") ? "" : " · 暂不可发布"}
      </option>)}
    </Select></label>
    {state === "failed" && <p role="alert" className="form-error">无法确认组织权限，草稿仍保留在本机。</p>}
    {state === "ready" && organizations.length === 0 && <p>当前没有可用的组织。</p>}
    {state === "ready" && value && !selected && <p role="alert" className="form-error">该组织当前不可发布，请重新选择或稍后重试。</p>}
    {state !== "loading" && <Button type="button" appearance="subtle" onClick={() => { setState("loading"); onResolvedSelection(undefined); setAttempt((value) => value + 1); }}>重新加载组织</Button>}
  </div>;
}

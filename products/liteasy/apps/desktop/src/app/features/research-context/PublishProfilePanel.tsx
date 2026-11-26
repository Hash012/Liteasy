import { useContext, useState } from "react";
import { Button, Checkbox } from "@fluentui/react-components";
import type { AcademicProfile } from "../profile/profile.types";
import { ContextPublicationContext } from "./contextPublication";

export function PublishProfilePanel({ profile, memories = [] }: { profile: AcademicProfile; memories?: { id: string; text: string }[] }) {
  const publish = useContext(ContextPublicationContext);
  const [selected, setSelected] = useState<string[]>([]);
  const fields = [
    ["stage", "研究阶段", profile.stage === "未设置" ? "" : profile.stage],
    ["disciplines", "学科", profile.disciplines.map((item) => `${item.name}${item.description ? `：${item.description}` : ""}`).join("；")],
    ["researchTopics", "研究主题", profile.researchTopics], ["researchMethods", "常用方法", profile.researchMethods],
    ["researchDatasets", "数据集", profile.researchDatasets], ["preferredLanguages", "阅读语言", profile.preferredLanguages],
    ...memories.map((item) => [`legacy/${item.id}`, "已有偏好（历史来源）", item.text])
  ].filter((field) => field[2]);
  return <section aria-label="发布已有画像"><h3>发布选定背景与偏好</h3>
    <p className="profile-muted">只发布勾选字段，原本机档案保留。历史偏好保持历史来源标记。</p>
    {fields.map(([id, label, value]) => <Checkbox key={id} checked={selected.includes(id)} label={`${label}：${value}`} onChange={(_, data) => setSelected((items) => data.checked ? [...items, id] : items.filter((item) => item !== id))} />)}
    <Button disabled={!publish || !selected.length} onClick={() => {
      let installation = localStorage.getItem("liteasy.context.installation.v1");
      if (!installation) { installation = crypto.randomUUID(); localStorage.setItem("liteasy.context.installation.v1", installation); }
      const chosen = fields.filter(([id]) => selected.includes(id));
      publish?.({ kind: "profile", title: "选定的研究背景与偏好", text: chosen.map(([, label, value]) => `## ${label}\n${value}`).join("\n\n"), basis: "user_statement",
        source: { provider: "liteasy", origin: `installation:${installation}`, sourceId: `profile/${chosen.map(([id]) => id).sort().join(",")}`, availability: "local_only", title: "选定的本机画像字段" } });
    }}>发布选定画像（{selected.length} 项）</Button>
  </section>;
}

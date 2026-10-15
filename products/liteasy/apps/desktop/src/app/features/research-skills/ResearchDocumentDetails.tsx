import { researchSkillDisplayTitle } from "./researchSkillDisplay";
import { DisclosureSection } from "../../shared/ui/productPrimitives";
import { useContext, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ResearchSkillsContext } from "./researchSkillsPort";
import type { ResearchDocument } from "./researchDocument";
import { ResourceReferencesContext } from "../resource-links/ResourceReferencesContext";
import { ResourceLink } from "../resource-links/ResourceReferenceView";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
export function ResearchDocumentDetails({ document }: { document: ResearchDocument }) {
  const skills = useContext(ResearchSkillsContext);
  const resources = useContext(ResourceReferencesContext);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <div aria-label="科研文档来源与版本">
    <p>保存到：{document.invocation.destination.title} · {researchSkillDisplayTitle(document.invocation.skill)} {document.invocation.skill.version}</p>
    <DisclosureSection title="方法技术信息"><pre>{JSON.stringify(document.invocation.skill, null, 2)}</pre></DisclosureSection>
    <p>结构与引用定位已检查，科研结论仍需核对。</p>
    <DisclosureSection title="本次实际读取的来源"><ul>{document.sources.map(source => <li key={source.id}>
      {resources && "objectId" in source.ref ? <ResourceLink locator={liteasyPath(resources.service.scope, { kind: "object", ref: source.ref })}>{source.id} · {source.title}</ResourceLink> : `${source.id} · ${source.title}`}
      <span> · {source.trustLabel === "source" ? "来源材料" : source.trustLabel === "derived" ? "派生资料" : "说明信息"}</span>
      <DisclosureSection title="查看本次读取文本"><pre className="research-source-text">{source.text}</pre></DisclosureSection>
    </li>)}</ul></DisclosureSection>
    {skills ? <Button disabled={busy} onClick={() => { setBusy(true); void skills.createEditableCopy(document).then(() => setMessage("已创建独立笔记，原科研文档版本保留")).catch(() => setMessage("暂时无法创建副本，请重试。原科研文档仍保留。")).finally(() => setBusy(false)); }}>创建可编辑副本</Button> : null}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}

import { DisclosureSection } from "../../shared/ui/productPrimitives";
import "./researchSkills.css";
import { Button, Dropdown, Option, Popover, PopoverTrigger, PopoverSurface, Tooltip } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { ContextRef } from "../context/objectContext";
import type { ResearchDestination, ResearchSkillSelection } from "./researchDocument";
import { listResearchSkills } from "./researchSkillCatalog";
export function ResearchSkillSelectionView({ selection, destinations, sources, onChange }: {
  selection: ResearchSkillSelection; destinations: ResearchDestination[];
  sources: { label: string; detail?: string; refs: ContextRef[] }[]; onChange(selection?: ResearchSkillSelection): void;
}) {
  const skill = listResearchSkills().find(skill => skill.ref?.packageDigest === selection.skill.packageDigest);
  return <section aria-label="所选科研方法" className="research-skill-selection">
    <div className="assistant-context-token-row">
      <Popover><PopoverTrigger disableButtonEnhancement><Button size="small">{skill?.title ?? selection.skill.id}</Button></PopoverTrigger>
        <PopoverSurface><strong>{skill?.title ?? selection.skill.id}</strong><p>{skill?.description ?? "此方法版本不可用，请重新选择。"}</p><p>版本 {selection.skill.version} · 生成并保存一份科研文档</p><p>科研结论需自行核对；不会执行实验、投稿或联网检索。</p></PopoverSurface></Popover>
      <Tooltip content="移除科研方法" relationship="label"><Button size="small" appearance="subtle" icon={<DismissRegular />} aria-label="移除科研方法" onClick={() => onChange(undefined)} /></Tooltip>
    </div>
    <label>保存到<Dropdown aria-label="科研文档保存到" placeholder="选择原论文条目" value={selection.destination?.title ?? ""} selectedOptions={selection.destination ? [selection.destination.canonicalEntryId] : []}
      onOptionSelect={(_, data) => onChange({ ...selection, destination: destinations.find(destination => destination.canonicalEntryId === data.optionValue) })}>
      {destinations.map(destination => <Option key={destination.canonicalEntryId} value={destination.canonicalEntryId}>{destination.title}</Option>)}
    </Dropdown></label>
    <DisclosureSection title={`资料用途与读取范围 · ${sources.length} 项`}>
      {!sources.length ? <p>请通过 @ 选择需要读取的原文、摘录或笔记。仅选择论文条目时会读取元数据。</p> : null}
      {sources.map((source, index) => <label key={index}>{source.label}<Dropdown aria-label={`资料用途：${source.label}`} value={skill?.adapter?.inputs.roles.find(role => role.id === selection.roles[JSON.stringify(source.refs[0])])?.label ?? skill?.adapter?.inputs.roles[0].label}
        onOptionSelect={(_, data) => onChange({ ...selection, roles: { ...selection.roles, ...Object.fromEntries(source.refs.map(ref => [JSON.stringify(ref), data.optionValue!])) } })}>
        {skill?.adapter?.inputs.roles.map(role => <Option key={role.id} value={role.id}>{role.label}</Option>)}
      </Dropdown><small>{source.detail || "读取所选对象的完整文本；没有自动读取整篇论文。"}</small></label>)}
    </DisclosureSection>
  </section>;
}

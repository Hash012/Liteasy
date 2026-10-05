import { SearchOptions, SearchHighlight } from "../search/SearchOptions";
import { useEffect, useRef } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Select, Spinner, Tooltip } from "@fluentui/react-components";
import { ArrowClockwiseRegular, BookmarkAddRegular, DismissRegular, SearchRegular, DeleteRegular } from "@fluentui/react-icons";
import type { GlobalSearchController } from "../../controllers/useGlobalSearchController";
import { searchGroups, type SearchGroup } from "./globalSearch.types";
import "./globalSearch.css";

export function GlobalSearchDialog({ model }: { model: GlobalSearchController }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (model.visible) input.current?.focus(); }, [model.visible]);
  return <Dialog open={model.visible} onOpenChange={(_, data) => { if (!data.open) model.close(); }}>
    <DialogSurface className="global-search-dialog"><DialogBody>
      <DialogTitle action={<Button appearance="subtle" aria-label="关闭全局搜索" icon={<DismissRegular />} onClick={model.close} />}>搜索工作区</DialogTitle>
      <DialogContent className="global-search-content">
        <div className="global-search-tools">
          <Input ref={input} aria-label="搜索词或引号短语" placeholder={'搜索文献、笔记、批注… 支持 "完整短语"'} value={model.query} contentBefore={<SearchRegular />} onChange={(_, data) => model.setQuery(data.value)} />
          <Select aria-label="搜索范围" value={model.group ?? "all"} onChange={(_, data) => model.setGroup(data.value === "all" ? undefined : data.value as SearchGroup)}><option value="all">全部内容</option>{Object.entries(searchGroups).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</Select>
          <Tooltip content="刷新来源与索引" relationship="label"><Button icon={<ArrowClockwiseRegular />} aria-label="刷新来源与索引" onClick={model.refresh} disabled={model.busy} /></Tooltip>
          <Tooltip content="保存查询" relationship="label"><Button icon={<BookmarkAddRegular />} aria-label="保存查询" onClick={() => void model.saveQuery()} disabled={!model.query.trim()} /></Tooltip>
        </div>
        <SearchOptions presentation="inline" query={model.query} onChange={model.setQuery} tags={model.tags} />
        {model.saved.length > 0 ? <div className="global-search-saved" aria-label="保存的查询">{model.saved.map((item, index) => <span key={index}><Button size="small" appearance="subtle" onClick={() => { model.setQuery(item.query); model.setGroup(item.group); }}>{item.query}{item.group ? ` · ${searchGroups[item.group]}` : ""}</Button><Button size="small" appearance="subtle" icon={<DeleteRegular />} aria-label={`删除查询 ${item.query}`} onClick={() => void model.saveQuery(item)} /></span>)}</div> : null}
        {model.error ? <p role="alert">{model.error}</p> : null}
        <div className="global-search-status" role="status">{model.busy ? <><Spinner size="tiny" /> 正在检索 · 已检查 {model.progress} 项 <Button size="small" appearance="subtle" onClick={model.cancel}>取消</Button></> : model.coverage ? <>{model.coverage.indexed} 项已索引 · {model.coverage.partial} 项部分正文 · {model.coverage.metadata} 项仅元信息{model.coverage.failed ? ` · ${model.coverage.failed} 项读取失败` : ""}</> : "搜索仅使用当前工作区可访问的本地内容。"}</div>
        {model.coverage?.limited ? <p role="status">本次达到检索容量上限，仅覆盖已索引内容。</p> : null}
        {model.coverage?.details.length ? <details className="global-search-coverage"><summary>查看索引覆盖情况</summary><ul>{model.coverage.details.map((item, index) => <li key={index}><strong>{item.title}</strong>：{item.detail}</li>)}</ul></details> : null}
        <div className="global-search-results" aria-label="搜索结果">
          {Object.entries(searchGroups).map(([group, label]) => {
            const hits = model.hits.filter((hit) => hit.group === group);
            return hits.length ? <section key={group}><h3>{label}</h3>{hits.map((hit) => <button type="button" className="global-search-hit" key={hit.id} onClick={() => void model.open(hit)}>
              <strong><SearchHighlight text={hit.title} query={model.query} /></strong><small>{hit.page ? `第 ${hit.page} 页` : hit.line ? `第 ${hit.line} 行附近` : label}</small><span><SearchHighlight text={hit.snippet} query={model.query} /></span>
            </button>)}</section> : null;
          })}
          {!model.busy && model.query.trim() && !model.error && !model.hits.length ? <p>已索引内容中未找到匹配项。可调整关键词或查看索引覆盖情况。</p> : null}
          {!model.query.trim() ? <p>输入关键词开始搜索；多个词需同时出现，引号保留完整短语。</p> : null}
          {model.nextOffset !== null ? <Button onClick={model.loadMore} disabled={model.busy}>更多结果</Button> : null}
        </div>
      </DialogContent>
    </DialogBody></DialogSurface>
  </Dialog>;
}

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Button, Field, Input, Tab, TabList, Tooltip } from "@fluentui/react-components";
import { ArrowDownRegular, ArrowUpRegular, DeleteRegular, DismissRegular } from "@fluentui/react-icons";
import { findReadingBlocks } from "./paperReadingNavigation";
import type { usePaperReadingNavigation } from "./usePaperReadingNavigation";

export type ReadingPanel = "contents" | "search" | "bookmarks";
export function PaperReadingNavigator({ panel, onPanelChange, onClose, navigation }: {
  panel: ReadingPanel;
  onPanelChange: (panel: ReadingPanel) => void;
  onClose: () => void;
  navigation: ReturnType<typeof usePaperReadingNavigation>;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => findReadingBlocks(navigation.blocks, deferredQuery), [navigation.blocks, deferredQuery]);
  const headings = navigation.blocks.filter((block) => block.level);
  const pages = navigation.blocks.filter((block, i, blocks) => block.page && blocks.findIndex((item) => item.page === block.page) === i);
  useEffect(() => { if (panel === "search") searchRef.current?.focus(); }, [panel]);
  useEffect(() => setSelected(-1), [deferredQuery, navigation.blocks]);
  const selectHit = (index: number) => {
    if (!hits.length) return;
    const next = (index + hits.length) % hits.length;
    setSelected(next); navigation.goToBlock(hits[next].block);
  };
  return <aside className="paper-reading-navigation" aria-label="阅读导航">
    <div className="paper-reading-navigation-header"><strong>阅读导航</strong>
      <Tooltip content="关闭导航（Esc）" relationship="description"><Button size="small" appearance="subtle" aria-label="关闭阅读导航" icon={<DismissRegular />} onClick={onClose} /></Tooltip>
    </div>
    <TabList size="small" selectedValue={panel} onTabSelect={(_, data) => onPanelChange(data.value as ReadingPanel)}>
      <Tab value="contents">目录</Tab><Tab value="search">查找</Tab><Tab value="bookmarks">书签</Tab>
    </TabList>
    <small className="paper-reading-navigation-hint">当前正文：{navigation.view}</small>
    {panel === "contents" ? <nav aria-label="论文目录">
      {headings.length ? headings.map((block) => <button type="button" className="paper-reading-navigation-item" key={block.key}
        style={{ paddingInlineStart: `${8 + (block.level - 1) * 12}px` }} aria-current={navigation.activeHeading === block.key ? "location" : undefined}
        onClick={() => navigation.goToBlock(block)}>{block.text}</button>) : pages.length ? pages.map((block) => (
        <button type="button" className="paper-reading-navigation-item" key={block.key} onClick={() => navigation.goToBlock(block)}>第 {block.page} 页</button>
      )) : <p>正文没有可识别的章节标题。可以使用查找或书签定位。</p>}
    </nav> : null}
    {panel === "search" ? <div className="paper-reading-search">
      <Field label="查找正文"><Input ref={searchRef} aria-label="查找阅读正文" value={query} placeholder="输入词语或短句" onChange={(_, data) => setQuery(data.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault(); selectHit(selected < 0 ? (event.shiftKey ? hits.length - 1 : 0) : selected + (event.shiftKey ? -1 : 1));
        } }} /></Field>
      <div className="paper-reading-search-controls"><span role="status">{deferredQuery.trim() ? `${hits.length === 100 ? "前 " : ""}${hits.length} 个匹配段落${selected >= 0 ? ` · ${selected + 1}/${hits.length}` : ""}` : "输入内容开始查找"}</span>
        <Tooltip content="上一个匹配段落（Shift + Enter）" relationship="description"><Button size="small" aria-label="上一个匹配段落" icon={<ArrowUpRegular />} disabled={!hits.length} onClick={() => selectHit(selected < 0 ? hits.length - 1 : selected - 1)} /></Tooltip>
        <Tooltip content="下一个匹配段落（Enter）" relationship="description"><Button size="small" aria-label="下一个匹配段落" icon={<ArrowDownRegular />} disabled={!hits.length} onClick={() => selectHit(selected + 1)} /></Tooltip>
      </div>
      {hits.map((hit, index) => <button type="button" key={hit.block.key} className="paper-reading-navigation-item" aria-current={index === selected ? "location" : undefined}
        onClick={() => selectHit(index)}>{hit.before}<mark>{hit.match}</mark>{hit.after}</button>)}
    </div> : null}
    {panel === "bookmarks" ? <div>
      <Button onClick={navigation.addBookmark} disabled={!navigation.blocks.length}>收藏当前位置</Button>
      {!navigation.bookmarks.length ? <p>给重要段落留个书签，下次可直接回来。</p> : null}
      {navigation.bookmarks.map((bookmark) => <div key={bookmark.id} className="paper-reading-bookmark">
        <button type="button" className="paper-reading-navigation-item" onClick={() => navigation.jump(bookmark.location)}>{bookmark.label}<small>{bookmark.location.view} · {Math.round(bookmark.location.ratio * 100)}%</small></button>
        <Tooltip content="移除这个书签" relationship="description"><Button size="small" appearance="subtle" aria-label={`移除书签：${bookmark.label}`} icon={<DeleteRegular />} onClick={() => navigation.removeBookmark(bookmark.id)} /></Tooltip>
      </div>)}
    </div> : null}
  </aside>;
}

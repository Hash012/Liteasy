import { useState } from "react";
import { Checkbox, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { ArrowLeftRegular, ArrowRightRegular, ArrowClockwiseRegular, LocationRegular, SettingsRegular } from "@fluentui/react-icons";
import { ActionButton, IconAction, OptionPicker } from "../../shared/ui/productPrimitives";
import type { ContextCatalogPort } from "./catalogPort";
import type { usePickerState } from "./usePickerState";
import { clearPickerActivity, readRecommendationSettings, saveRecommendationSettings, type RecommendationSettings } from "./recommendations";
import "./contextPicker.css";

export function PickerNavigation({ picker, catalog, activePaperId, scope, onRefresh }: {
  picker: ReturnType<typeof usePickerState>; catalog: ContextCatalogPort; activePaperId?: string; scope: string; onRefresh(): void;
}) {
  const [settings, setSettings] = useState(() => readRecommendationSettings(scope));
  const change = (patch: Partial<RecommendationSettings>) => { const next = { ...settings, ...patch }; setSettings(next); saveRecommendationSettings(scope, next); onRefresh(); };
  return <div className="context-picker-navigation">
    <IconAction label="返回上层位置" icon={<ArrowLeftRegular />} appearance="subtle" disabled={picker.browse.historyIndex <= 0} onClick={picker.back} />
    <IconAction label="前进" icon={<ArrowRightRegular />} appearance="subtle" disabled={picker.browse.historyIndex >= picker.browse.history.length - 1} onClick={picker.forward} />
    <nav aria-label="上下文位置" className="context-picker-breadcrumbs">{catalog.breadcrumbs(picker.browse.route).map((crumb, index) => <ActionButton key={index} appearance="subtle" size="small" aria-current={index === picker.browse.route.length - 1 ? "location" : undefined} onClick={() => picker.navigate(crumb.route)}>{crumb.title}</ActionButton>)}</nav>
    {activePaperId && catalog.entries.has(activePaperId) ? <IconAction label="定位当前论文" icon={<LocationRegular />} appearance="subtle" onClick={() => picker.navigate(["collections", "all-papers", `paper:${activePaperId}`])} /> : null}
    {picker.browse.route[0] === "recommendations" ? <>
      <IconAction label="刷新推荐" icon={<ArrowClockwiseRegular />} appearance="subtle" onClick={onRefresh} />
      <Popover><PopoverTrigger disableButtonEnhancement><IconAction label="推荐设置" icon={<SettingsRegular />} appearance="subtle" /></PopoverTrigger>
        <PopoverSurface aria-label="推荐设置" className="context-picker-recommendation-settings">
          {([ ["enabled", "启用推荐"], ["recentReading", "使用最近阅读"], ["recentCreated", "使用最近创建"], ["draftSimilarity", "使用当前问题"], ["projectFirst", "当前项目优先"] ] as const).map(([key, title]) => <Checkbox key={key} label={title} checked={settings[key]} onChange={(_, data) => change({ [key]: data.checked === true })} />)}
          <OptionPicker aria-label="推荐数量" value={String(settings.count)} options={[4, 6, 8, 12].map(count => ({ value: String(count), label: `${count} 项` }))} onValueChange={value => change({ count: Number(value) })} />
          <ActionButton onClick={() => { clearPickerActivity(scope); onRefresh(); }}>清除推荐历史</ActionButton>
        </PopoverSurface>
      </Popover>
    </> : null}
  </div>;
}

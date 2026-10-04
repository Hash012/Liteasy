import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Button, Dialog, DialogSurface, Tooltip } from "@fluentui/react-components";
import { ArrowLeftRegular, ArrowRightRegular, CheckmarkRegular, DismissRegular, PauseRegular, PlayRegular, PlayCircleRegular } from "@fluentui/react-icons";
import { onboardingSteps, placeTourCard, type OnboardingModel, type TourRect } from "./onboarding";
import { useOnboarding } from "./onboardingContext";
import "./onboarding.css";

export function OnboardingInvitation() {
  const tour = useOnboarding();
  if (!tour || !tour.invitation && !tour.error) return null;
  return <aside className="onboarding-invitation" aria-label="首次使用导览">
    <PlayCircleRegular aria-hidden />
    <div><strong>第一次使用 Liteasy？</strong><p>跟着聚光导览认识阅读、笔记与 AI。播放后将展开常用页面。</p>
      <div><Button appearance="primary" icon={<PlayRegular />} onClick={tour.start}>开始导览</Button><Button appearance="subtle" onClick={tour.dismissInvitation}>稍后再说</Button></div>
      {tour.error ? <p role="alert">{tour.error}</p> : null}
    </div>
  </aside>;
}

/** Observe only during the guide, and coalesce layout reads into one animation frame. */
function useSpotlight(target: string, card: RefObject<HTMLDivElement>) {
  const [geometry, setGeometry] = useState<{ target: TourRect | null; card: { left: number; top: number } }>({ target: null, card: { left: 12, top: 60 } });
  useLayoutEffect(() => {
    let frame = 0;
    let observed: Element | null = null;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    const measure = () => {
      frame = 0;
      const element = [...document.querySelectorAll<HTMLElement>(target)].find(node => node.getClientRects().length && !node.closest("[hidden]"));
      if (observed !== element) { if (observed) resize.unobserve(observed); observed = element ?? null; if (observed) resize.observe(observed); }
      const bounds = element?.getBoundingClientRect();
      const width = window.innerWidth, height = window.innerHeight;
      const left = Math.max(4, (bounds?.left ?? 0) - 5), top = Math.max(4, (bounds?.top ?? 0) - 5);
      const right = Math.min(width - 4, (bounds?.right ?? 0) + 5), bottom = Math.min(height - 4, (bounds?.bottom ?? 0) + 5);
      const visible = bounds && bounds.width > 0 && bounds.height > 0 && right > left && bottom > top;
      const nextTarget = visible ? { left, top, width: right - left, height: bottom - top } : null;
      const size = card.current?.getBoundingClientRect();
      const next = { target: nextTarget, card: placeTourCard(nextTarget, { width: size?.width ?? Math.min(360, width - 24), height: size?.height ?? 320 }, { width, height }) };
      setGeometry(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    if (card.current) resize.observe(card.current);
    const mutations = new MutationObserver(schedule);
    const root = document.querySelector(".app-frame");
    if (root) mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    schedule();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); window.removeEventListener("resize", schedule); document.removeEventListener("scroll", schedule, true); };
  }, [target, card]);
  return geometry;
}

function TourSurface({ model }: { model: OnboardingModel & { index: number } }) {
  const step = onboardingSteps[model.index];
  const card = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const geometry = useSpotlight(step.target, card);
  const last = model.index === onboardingSteps.length - 1;
  useLayoutEffect(() => { title.current?.focus({ preventScroll: true }); }, [model.index]);
  return <DialogSurface ref={card} className="onboarding-card" data-onboarding-tour="true" aria-label="Liteasy 新手导览" aria-describedby="onboarding-description"
    style={{ left: geometry.card.left, top: geometry.card.top }}
    backdrop={{ appearance: "transparent", className: "onboarding-backdrop", children: geometry.target
      ? <div className="onboarding-spotlight" style={geometry.target} data-tour-target={step.id} />
      : <div className="onboarding-dim" /> }}
    onKeyDown={(event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
      if (event.key === "ArrowRight" && !last) { event.preventDefault(); model.next(); }
      if (event.key === "ArrowLeft") { event.preventDefault(); model.previous(); }
    }}>
    <div className="onboarding-card-header"><span>认识 Liteasy</span><span>{model.index + 1} / {onboardingSteps.length}</span>
      <Tooltip content="退出导览 · Esc" relationship="label"><Button appearance="subtle" aria-label="退出导览" icon={<DismissRegular />} onClick={() => model.close()} /></Tooltip>
    </div>
    <div className="onboarding-progress" role="progressbar" aria-label="导览进度" aria-valuemin={0} aria-valuemax={onboardingSteps.length} aria-valuenow={model.index + 1}>
      {onboardingSteps.map((item, index) => <span key={item.id} className={index <= model.index ? "is-complete" : ""} />)}
    </div>
    <div className="onboarding-copy" key={step.id}>
      <h2 ref={title} tabIndex={-1}>{step.title}</h2>
      <p id="onboarding-description">{step.description}</p>
      <p className="onboarding-tip">{step.tip}</p>
      {!geometry.target ? <small>正在定位此区域；也可以继续下一步。</small> : null}
    </div>
    <footer className="onboarding-actions">
      {!last ? <Tooltip content={model.automatic ? "暂停自动播放" : "每 12 秒进入下一步"} relationship="description"><Button appearance="subtle" size="small"
        aria-label={model.automatic ? "暂停自动播放" : "自动播放导览"} aria-pressed={model.automatic}
        icon={model.automatic ? <PauseRegular /> : <PlayRegular />} onClick={model.toggleAutomatic}>{model.automatic ? "暂停" : "自动播放"}</Button></Tooltip> : <span />}
      <Button appearance="subtle" disabled={model.index === 0} icon={<ArrowLeftRegular />} onClick={model.previous}>上一步</Button>
      <Button appearance="primary" iconPosition="after" icon={last ? <CheckmarkRegular /> : <ArrowRightRegular />} onClick={model.next}>{last ? "开始使用" : "下一步"}</Button>
    </footer>
    {model.automatic && !last ? <div className="onboarding-timer" key={`${model.index}:${model.background}`} style={{ animationPlayState: model.background ? "paused" : "running" }} /> : null}
  </DialogSurface>;
}

export function OnboardingTour({ model }: { model: OnboardingModel }) {
  if (model.index === null) return null;
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && data.type !== "backdropClick") model.close(); }}>
    <TourSurface model={{ ...model, index: model.index }} />
  </Dialog>;
}

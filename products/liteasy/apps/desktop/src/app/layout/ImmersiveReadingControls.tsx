import { Button, Tooltip } from "@fluentui/react-components";
import { DismissRegular, FullScreenMaximizeRegular, FullScreenMinimizeRegular } from "@fluentui/react-icons";
import type { ReadingFocusEdge, ReadingFocusMode } from "../controllers/useImmersiveReadingController";
import "../styles/immersiveReading.css";

export function ImmersiveReadingControls({ mode, error, reveal, exit, toggleFullscreen }: {
  mode: ReadingFocusMode; error: string; reveal(edge: ReadingFocusEdge): void; exit(): void; toggleFullscreen(): void;
}) {
  return <>
    {mode !== "off" ? <>
      {(mode === "fullscreen" ? ["top", "left", "right", "bottom"] as const : []).map((edge) => <button key={edge} type="button"
        className={`immersive-edge immersive-edge-${edge}`} aria-label={`显示${{ top: "顶部工具", left: "左侧栏", right: "右侧栏", bottom: "底部面板" }[edge]}`}
        onFocus={() => reveal(edge)} onClick={() => reveal(edge)} />)}
      <div className="immersive-controls" role="toolbar" aria-label="沉浸阅读控制" onFocus={() => reveal("top")}>
        <span>沉浸阅读 · Esc 退出</span>
        <Tooltip content="切换全屏专注（F11）" relationship="description"><Button size="small" appearance="subtle"
          aria-label="切换全屏专注" aria-pressed={mode === "fullscreen"} icon={mode === "fullscreen" ? <FullScreenMinimizeRegular /> : <FullScreenMaximizeRegular />} onClick={toggleFullscreen} /></Tooltip>
        <Tooltip content="退出沉浸阅读（Esc）" relationship="description"><Button size="small" appearance="subtle" aria-label="退出沉浸阅读" icon={<DismissRegular />} onClick={exit} /></Tooltip>
      </div>
    </> : null}
    {error ? <div className="immersive-error" role="alert">{error}<Button appearance="subtle" size="small" onClick={exit}>退出沉浸阅读</Button></div> : null}
  </>;
}

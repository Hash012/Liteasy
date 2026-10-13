import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { ActionButton, InlineNotice } from "./productPrimitives";
import { reportSurfaceError, subscribeSurfaceDiagnostics, type SurfaceDiagnostic } from "./surfaceDiagnostics";

type Props = { surface: string; instance?: string; children: ReactNode; onClose?: () => void };
type State = { failed: boolean; diagnostic?: SurfaceDiagnostic; copyStatus?: string };
function AsyncNotice({ surface, instance }: { surface: string; instance?: string }) {
  const [record, setRecord] = useState<SurfaceDiagnostic>();
  useEffect(() => subscribeSurfaceDiagnostics((next, owner) => { if (next.surface === surface && owner === instance && next.kind !== "render") setRecord(next); }), [surface, instance]);
  return record ? <InlineNotice intent="error" message="刚才的操作未完成，请重试。当前内容仍保留。" action={<ActionButton onClick={() => setRecord(undefined)}>知道了</ActionButton>} /> : null;
}
/** Retrying a view never remounts sibling documents or their drafts. */
export class SurfaceErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { this.setState({ diagnostic: reportSurfaceError(this.props.surface, error, "render", info.componentStack ?? "") }); }
  render() {
    return <>{this.state.failed ? <div className="product-surface-failure" role="alert"><h3>此面板暂时无法显示</h3><p>可以重试面板。其他已打开内容仍可使用，原始资料未被清理。</p><div className="product-surface-actions"><ActionButton onClick={() => this.setState({ failed: false, diagnostic: undefined, copyStatus: undefined })}>重试面板</ActionButton>{this.props.onClose ? <ActionButton onClick={this.props.onClose}>关闭面板</ActionButton> : null}<ActionButton onClick={() => { void navigator.clipboard.writeText(JSON.stringify(this.state.diagnostic ?? { surface: this.props.surface }, null, 2)).then(() => this.setState({ copyStatus: "已复制诊断信息" }), () => this.setState({ copyStatus: "复制失败，请重试" })); }}>复制脱敏诊断</ActionButton></div>{this.state.copyStatus ? <p role="status">{this.state.copyStatus}</p> : null}</div> : <><AsyncNotice surface={this.props.surface} instance={this.props.instance} />{this.props.children}</>}</>;
  }
}
/** Render callbacks must execute inside the boundary's child tree. */
export function SurfaceRenderer({ render }: { render: () => ReactNode }) { return <>{render()}</>; }

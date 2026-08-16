import { Component, type ErrorInfo, type ReactNode } from "react";

type RootErrorBoundaryProps = {
  children: ReactNode;
};

type RootErrorBoundaryState = {
  errorCode: string | null;
};

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z0-9_.:-]{1,120}$/i.test(message) ? message : "desktop_startup_failed";
}

export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { errorCode: null };

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    return { errorCode: safeErrorCode(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Liteasy startup failed", error, info.componentStack);
  }

  render() {
    if (!this.state.errorCode) return this.props.children;

    return (
      <main className="startup-error" role="alert">
        <div className="startup-error__content">
          <h1>Liteasy 启动失败</h1>
          <p>应用未能完成初始化。</p>
          <code>{this.state.errorCode}</code>
          <button onClick={() => window.location.reload()} type="button">重新启动</button>
        </div>
      </main>
    );
  }
}

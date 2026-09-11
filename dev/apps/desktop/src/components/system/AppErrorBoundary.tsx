import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { METHOD_TIMEOUT_MS } from "@/lib/invoke";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

const panelStyle: CSSProperties = {
  minHeight: "100vh",
  margin: 0,
  padding: "2rem",
  boxSizing: "border-box",
  fontFamily: "system-ui, sans-serif",
  background: "#121212",
  color: "#ececec",
};

const messageStyle: CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "ui-monospace, monospace",
  fontSize: "0.85rem",
  opacity: 0.85,
};

const actionsStyle: CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  marginTop: "1.5rem",
};

/**
 * Root fallback — independent of i18n and app providers.
 * English literals are intentional (the crash may have come from I18nProvider).
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[upriv] ui crash", error, info.componentStack);
    const api = window.upriv;
    if (api && typeof api.invoke === "function") {
      void api
        .invoke("log_event", { event: "ui_crash" }, METHOD_TIMEOUT_MS.log_event)
        .catch(() => undefined);
    }
  }

  private reload = (): void => {
    window.location.reload();
  };

  private quit = (): void => {
    const api = window.upriv;
    if (api && typeof api.invoke === "function") {
      void api.invoke("app_exit", {}, METHOD_TIMEOUT_MS.app_exit).catch(() => undefined);
      return;
    }
    window.close();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div style={panelStyle} role="alert">
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Upriv encountered an error</h1>
        <p>The window can be reloaded. If this keeps happening, quit and reopen the app.</p>
        <pre style={messageStyle}>{this.state.error.message}</pre>
        <div style={actionsStyle}>
          <button type="button" onClick={this.reload}>
            Reload
          </button>
          <button type="button" onClick={this.quit}>
            Quit
          </button>
        </div>
      </div>
    );
  }
}

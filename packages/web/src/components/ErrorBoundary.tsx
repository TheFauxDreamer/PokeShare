import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps a render error from blanking the page.
 *
 * This is a streaming tool: a black screen mid-broadcast is the worst possible
 * failure. Showing the error and a reload button degrades far more gracefully,
 * and states what still works — the emulator itself is unaffected by a crash in
 * the surrounding UI.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | undefined }
> {
  override state: { error: Error | undefined } = { error: undefined };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the full component stack in the console for diagnosis.
    console.error("PokeShare UI error", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="landing">
        <h1>Something broke in the interface</h1>
        <p className="error">{error.message}</p>
        <p>
          Your run is safe — it lives on the server, not in this page. Reloading
          reconnects to it.
        </p>
        <button type="button" onClick={() => globalThis.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

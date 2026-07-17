import { Component, type ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

/** A render crash shows an error panel instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <section>
          <h1>Something broke</h1>
          <div className="notice">
            <p>{this.state.error.message}</p>
          </div>
          <button className="primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}

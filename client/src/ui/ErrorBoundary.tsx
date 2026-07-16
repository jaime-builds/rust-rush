import { Component, ErrorInfo, ReactNode } from 'react'

// Minimal error boundary so a rendering crash in one UI section (the canvas,
// a modal) degrades to an inline fault panel instead of blanking the whole
// page. Class component because React only exposes error boundaries that way.

interface Props {
  /** Short label for the fault panel, e.g. "GAME VIEW". */
  section: string
  children: ReactNode
}

interface State {
  error: Error | null
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.section}] render error:`, error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary panel">
          <div className="error-boundary-title">⚠ {this.props.section} FAULT</div>
          <p className="error-boundary-msg">{this.state.error.message}</p>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            RETRY
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary

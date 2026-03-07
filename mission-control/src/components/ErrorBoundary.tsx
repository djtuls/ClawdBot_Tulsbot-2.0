"use client";

import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex items-center justify-center min-h-[200px] p-8">
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 max-w-md text-center">
              <p className="text-red-400 font-medium mb-2">Something went wrong</p>
              <p className="text-xs text-zinc-500 mb-4">{this.state.error?.message}</p>
              <button
                onClick={() => this.setState({ hasError: false })}
                className="bg-[#1C1C1F] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#2A2A2E]"
              >
                Try again
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

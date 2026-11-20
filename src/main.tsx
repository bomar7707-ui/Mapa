import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class MapErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Neočekávaná chyba vykreslování mapy.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-[#F6F5F1] text-[#1C2420] p-6">
          <div className="max-w-md w-full bg-white border border-[#1C2420]/15 rounded-xl shadow-sm p-6 space-y-4">
            <h1 className="text-base font-semibold">
              Při vykreslování mapy došlo k chybě
            </h1>
            <p className="text-xs text-[#5B6760] leading-relaxed">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#1E5631] hover:bg-[#174325] rounded-lg transition-colors"
            >
              Znovu načíst mapu
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <MapErrorBoundary>
    <App />
  </MapErrorBoundary>
);

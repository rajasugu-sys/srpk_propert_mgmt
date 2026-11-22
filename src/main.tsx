import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

async function clearAppCachesAndReload(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // ignore cleanup errors
  }
  window.location.reload();
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  void clearAppCachesAndReload();
});

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      window.setInterval(() => {
        void registration.update();
      }, 60 * 60 * 1000);
    }
  },
});

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected rendering error.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full max-w-md mx-auto bg-gray-50 flex items-center justify-center p-5">
          <div className="w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#489E44] text-white font-extrabold text-sm">
              SR
            </div>
            <div className="space-y-1">
              <h1 className="text-base font-bold text-[#0f172a]">
                SRPK Estate Needs a Quick Refresh
              </h1>
              <p className="text-xs text-gray-500 leading-relaxed">
                A cached update or connection interruption prevented the screen from loading.
              </p>
              {this.state.message && (
                <p className="text-[11px] font-mono text-rose-600 break-words pt-1">
                  {this.state.message}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void clearAppCachesAndReload()}
              className="w-full rounded-xl bg-[#489E44] px-4 py-3 text-xs font-bold text-white hover:bg-[#3E8E41] cursor-pointer"
            >
              Reload &amp; Clear Cached Assets
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);

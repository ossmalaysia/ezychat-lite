import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ApiError } from './api/client';
import { RealtimeProvider } from './api/socket';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import {
  registerExtensionCatalogs,
  validateWebExtensions,
  WebExtensionsProvider,
  type WebExtension,
} from './extensions';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { installGlobalErrorReporting } from '@/lib/error-reporter';
import { localeStore } from '@/i18n/locale-store';
import { LocaleSync } from '@/i18n/LocaleSync';
import './index.css';

export interface CreateInboxAppOptions {
  /** UI added by another product build. Lite passes `[]`. */
  extensions?: readonly WebExtension[];
  /** Element to render into; defaults to `#root`. */
  root?: HTMLElement;
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: (count, e) =>
          !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}

/**
 * Renders the inbox app. Extensions are validated first (a bad extension throws before anything
 * renders) and their catalogs are merged on top of the core catalogs.
 */
export async function createInboxApp({
  extensions = [],
  root = document.getElementById('root') ?? undefined,
}: CreateInboxAppOptions = {}): Promise<void> {
  validateWebExtensions(extensions);
  if (!root) throw new Error('#root missing');

  // Uncaught errors / unhandled rejections → server log (structured `mod: "web"` entries).
  installGlobalErrorReporting();

  const queryClient = createQueryClient();
  const render = () =>
    createRoot(root).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <WebExtensionsProvider extensions={extensions}>
              <AuthProvider>
                <LocaleSync />
                <RealtimeProvider>
                  <TooltipProvider delayDuration={300}>
                    <App />
                    <Toaster position="top-center" closeButton richColors={false} />
                  </TooltipProvider>
                </RealtimeProvider>
              </AuthProvider>
            </WebExtensionsProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </StrictMode>,
    );

  // PWA service-worker registration lives in src/pwa/registerSW.ts. The glob keeps this file
  // building whether or not that module exists.
  const pwaModules = import.meta.glob<{ registerSW?: () => unknown; default?: () => unknown }>(
    './pwa/registerSW.ts',
  );
  for (const load of Object.values(pwaModules)) {
    void load()
      .then((m) => (m.registerSW ?? m.default)?.())
      .catch((e: unknown) => console.warn('Service worker registration failed', e));
  }

  // Load the chosen language's catalogs before the first paint so nobody sees an English flash.
  // A failed chunk load still renders (English fallback) rather than a blank page.
  const catalogs =
    extensions.length > 0 ? registerExtensionCatalogs(extensions) : Promise.resolve();
  await catalogs
    .then(() => localeStore.ready())
    .catch((e: unknown) => console.warn('Language load failed', e))
    .finally(render);
}

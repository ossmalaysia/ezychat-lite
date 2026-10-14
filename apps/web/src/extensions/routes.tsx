import type { ReactNode } from 'react';
import { Route, useLocation } from 'react-router-dom';
import { ErrorBoundary } from '@/components/app/ErrorBoundary';
import type { WebExtension } from './types';

/** Wraps one extension element so a crash inside it never blanks the rest of the app. */
export function ExtensionBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}

/**
 * `<Route>` elements for the extensions' routes of one kind. User routes are absolute
 * (`/ext/<name>/<path>`); admin routes are relative to the admin shell (`ext/<name>/<path>`).
 * The fixed `ext/<name>/` prefix means an extension route can never match a core path.
 */
export function extensionRoutes(extensions: readonly WebExtension[], admin: boolean): ReactNode[] {
  return extensions.flatMap((ext) =>
    (ext.routes ?? [])
      .filter((r) => !!r.admin === admin)
      .map((r) => {
        const path = `${admin ? '' : '/'}ext/${ext.name}/${r.path}`;
        return (
          <Route
            key={`${ext.name}:${path}`}
            path={path}
            element={<ExtensionBoundary>{r.element}</ExtensionBoundary>}
          />
        );
      }),
  );
}

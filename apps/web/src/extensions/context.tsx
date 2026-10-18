import { createContext, useContext, type ReactNode } from 'react';
import type { WebExtension } from './types';

const NO_EXTENSIONS: readonly WebExtension[] = [];
const WebExtensionsContext = createContext<readonly WebExtension[]>(NO_EXTENSIONS);

/** Makes the (already validated) extensions available to the app shell. Lite passes none. */
export function WebExtensionsProvider({
  extensions,
  children,
}: {
  extensions: readonly WebExtension[];
  children: ReactNode;
}) {
  return (
    <WebExtensionsContext.Provider value={extensions}>{children}</WebExtensionsContext.Provider>
  );
}

export function useWebExtensions(): readonly WebExtension[] {
  return useContext(WebExtensionsContext);
}

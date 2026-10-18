import { createContext, useContext, type ReactNode } from 'react';
import { LITE_APP_LINKS, type AppLinks } from './links';

const AppLinksContext = createContext<AppLinks>(LITE_APP_LINKS);

/** Supplies the product's outside links (`createInboxApp({ links })`); Lite's links otherwise. */
export function AppLinksProvider({ links, children }: { links: AppLinks; children: ReactNode }) {
  return <AppLinksContext.Provider value={links}>{children}</AppLinksContext.Provider>;
}

/** The product's outside links. A `null` link is hidden by the component that shows it. */
export function useAppLinks(): AppLinks {
  return useContext(AppLinksContext);
}

import { useMemo } from 'react';
import { useWebExtensions } from './context';
import type { WebExtension, WebExtensionInboxType } from './types';

/** The core's own type (QR-linked phone); an extension can never replace it. */
const LINKED_PHONE = 'linked_phone';

/** Every extension inbox type in extension order; the first extension wins a duplicate type id. */
export function inboxTypesOf(extensions: readonly WebExtension[]): WebExtensionInboxType[] {
  const seen = new Set<string>([LINKED_PHONE]);
  const types: WebExtensionInboxType[] = [];
  for (const ext of extensions)
    for (const type of ext.inboxTypes ?? []) {
      if (seen.has(type.type)) continue;
      seen.add(type.type);
      types.push(type);
    }
  return types;
}

/** Inbox connection types the extensions add (none in Lite). */
export function useInboxTypes(): readonly WebExtensionInboxType[] {
  const extensions = useWebExtensions();
  return useMemo(() => inboxTypesOf(extensions), [extensions]);
}

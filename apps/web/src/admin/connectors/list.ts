import type { LucideIcon } from 'lucide-react';
import type {
  ConnectorConnectionView,
  ConnectorEntry,
  ConnectorTool,
  GalleryConnector,
} from '@ezychat/shared';
import { CATEGORY_ICON, LIST_CATEGORY, type ConnectorStatus } from './catalog';

/** A partner connection that exists (working or not): it has settings, activity and Disconnect. */
export function isLinked(connection: ConnectorConnectionView | null | undefined): boolean {
  const state = connection?.state;
  return state === 'connected' || state === 'needs_sign_in' || state === 'unreachable';
}

/** The card and header status of a connector from the list. */
export function listStatus(g: GalleryConnector): ConnectorStatus {
  if (g.delisted) return 'delisted';
  if (g.fit === 'needsUpdate') return 'needsUpdate';
  if (g.fit === 'enterprise') return 'enterprise';
  if (g.entry.kind === 'coming_soon') return 'comingSoon';
  if (g.connection?.state === 'connected') return 'connected';
  if (isLinked(g.connection)) return 'attention';
  return 'notConnected';
}

/** Saved tool switches over the defaults: look-ups start on, tools that change data off. */
export function withToolDefaults(
  tools: readonly ConnectorTool[],
  saved: Record<string, boolean>,
): Record<string, boolean> {
  return Object.fromEntries(
    tools.map((tool) => [tool.name, saved[tool.name] ?? tool.access === 'read']),
  );
}

/** The icon tile of an entry: its own icon file from the list, else its category's icon. */
export function entryIcon(entry: ConnectorEntry): { icon: LucideIcon; image?: string } {
  return {
    icon: CATEGORY_ICON[LIST_CATEGORY[entry.category]],
    image: entry.icon ? `/api/connectors/icons/${encodeURIComponent(entry.icon.file)}` : undefined,
  };
}

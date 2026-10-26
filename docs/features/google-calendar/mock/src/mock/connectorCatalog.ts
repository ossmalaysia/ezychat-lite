import { CalendarDays, CreditCard, Plug, ShoppingBag, Table2, type LucideIcon } from 'lucide-react';
import type { GoogleState } from './googleCalendar';

/**
 * Proposed (google-calendar → connector gallery): the ready connectors the app knows about. In the
 * app this list is the core's built-in connectors plus any an edition adds (Enterprise: payments,
 * Shopify, its custom MCP connector) through a web extension slot. Texts are catalog keys under
 * `mockConnectors.items.<id>`.
 */
export type ConnectorCategory = 'booking' | 'data' | 'payments' | 'commerce' | 'custom';
export const CONNECTOR_CATEGORIES: readonly ConnectorCategory[] = [
  'booking',
  'data',
  'payments',
  'commerce',
  'custom',
];

export interface CatalogConnector {
  id: string;
  icon: LucideIcon;
  category: ConnectorCategory;
  /** `core`: Lite and Enterprise. `enterprise`: shown in Lite with an upgrade note. */
  edition: 'core' | 'enterprise';
  /** Ready now, or listed so admins see what is coming. */
  available: boolean;
  /** What the AI may do with it: look-ups (read) and actions that change data. */
  tools: { key: string; access: 'read' | 'write' }[];
}

export const CONNECTORS: readonly CatalogConnector[] = [
  {
    id: 'google-calendar',
    icon: CalendarDays,
    category: 'booking',
    edition: 'core',
    available: true,
    tools: [
      { key: 'checkFree', access: 'read' },
      { key: 'book', access: 'write' },
    ],
  },
  {
    id: 'google-sheets',
    icon: Table2,
    category: 'data',
    edition: 'core',
    available: false,
    tools: [
      { key: 'readRows', access: 'read' },
      { key: 'addLead', access: 'write' },
    ],
  },
  {
    id: 'hitpay',
    icon: CreditCard,
    category: 'payments',
    edition: 'enterprise',
    available: false,
    tools: [
      { key: 'paymentLink', access: 'write' },
      { key: 'paymentStatus', access: 'read' },
    ],
  },
  {
    id: 'shopify',
    icon: ShoppingBag,
    category: 'commerce',
    edition: 'enterprise',
    available: false,
    tools: [
      { key: 'orderStatus', access: 'read' },
      { key: 'productStock', access: 'read' },
    ],
  },
  {
    id: 'custom-mcp',
    // Owner (2026-10-26): listed in Lite greyed out, marked Enterprise only.
    icon: Plug,
    category: 'custom',
    edition: 'enterprise',
    available: true,
    tools: [],
  },
];

/** The state a gallery card shows. */
export type ConnectorStatus =
  'connected' | 'attention' | 'notConnected' | 'comingSoon' | 'enterprise';

export function connectorStatus(
  c: CatalogConnector,
  edition: 'lite' | 'enterprise',
  google: GoogleState | undefined,
): ConnectorStatus {
  if (c.edition === 'enterprise' && edition === 'lite') return 'enterprise';
  if (!c.available) return 'comingSoon';
  if (c.id === 'google-calendar') {
    if (google === 'connected') return 'connected';
    if (google === 'expired' || google === 'unavailable') return 'attention';
  }
  return 'notConnected';
}

/** The connectors an edition lists: every edition lists all; Lite greys out Enterprise ones. */
export function listedConnectors(_edition: 'lite' | 'enterprise'): readonly CatalogConnector[] {
  return CONNECTORS;
}

/** Categories with at least one listed connector. */
export function listedCategories(edition: 'lite' | 'enterprise'): ConnectorCategory[] {
  const listed = listedConnectors(edition);
  return CONNECTOR_CATEGORIES.filter((cat) => listed.some((c) => c.category === cat));
}

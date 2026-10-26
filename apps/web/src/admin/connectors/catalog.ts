import {
  BookOpenCheck,
  Calculator,
  CalendarDays,
  ContactRound,
  CreditCard,
  Plug,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  Store,
  Table2,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { GoogleCalendarState } from '@ezychat/shared';

/**
 * Admin → Connectors: the ready connectors the app knows about (design
 * docs/features/google-calendar/design.md). Every connector is offered in every edition; only the
 * custom MCP connector needs Enterprise, whose web extension links it (`connectorLinks`). Texts are
 * catalog keys under `connectors.items.<id>` and `connectors.tools.<tool>` (admin namespace).
 */
export const CONNECTOR_CATEGORIES = [
  'booking',
  'accounting',
  'crm',
  'data',
  'payments',
  'commerce',
  'custom',
] as const;
export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number];

/** What the AI may do with a connector; the texts are shared between connectors. */
export type ConnectorTool =
  | 'checkFree'
  | 'book'
  | 'readRows'
  | 'addRow'
  | 'paymentLink'
  | 'paymentStatus'
  | 'orderStatus'
  | 'productStock'
  | 'stock'
  | 'quotation'
  | 'outstanding'
  | 'invoice'
  | 'contact'
  | 'findContact'
  | 'addLead'
  | 'member';

export const CONNECTOR_IDS = [
  'google-calendar',
  'google-sheets',
  'hitpay',
  'shopify',
  'autocount',
  'sql-account',
  'bukku',
  'xero',
  'zoho-books',
  'zoho-crm',
  'hubspot',
  'woocommerce',
  'easystore',
  'storehub',
  'billplz',
  'custom-mcp',
] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export interface CatalogConnector {
  id: ConnectorId;
  icon: LucideIcon;
  category: ConnectorCategory;
  /** `core`: every edition. `enterprise`: greyed out unless an extension links it. */
  edition: 'core' | 'enterprise';
  /** Ready now, or listed so admins see what is coming (and can vote for it). */
  available: boolean;
  /** Look-ups (read) and actions that change data. */
  tools: readonly { key: ConnectorTool; access: 'read' | 'write' }[];
}

const soon = (
  id: ConnectorId,
  icon: LucideIcon,
  category: ConnectorCategory,
  tools: CatalogConnector['tools'],
): CatalogConnector => ({ id, icon, category, edition: 'core', available: false, tools });

const read = (key: ConnectorTool) => ({ key, access: 'read' as const });
const write = (key: ConnectorTool) => ({ key, access: 'write' as const });

export const CONNECTORS: readonly CatalogConnector[] = [
  {
    id: 'google-calendar',
    icon: CalendarDays,
    category: 'booking',
    edition: 'core',
    available: true,
    tools: [read('checkFree'), write('book')],
  },
  soon('google-sheets', Table2, 'data', [read('readRows'), write('addRow')]),
  soon('hitpay', CreditCard, 'payments', [write('paymentLink'), read('paymentStatus')]),
  soon('shopify', ShoppingBag, 'commerce', [read('orderStatus'), read('productStock')]),
  soon('autocount', Calculator, 'accounting', [read('stock'), write('quotation')]),
  soon('sql-account', Receipt, 'accounting', [read('stock'), read('outstanding')]),
  soon('bukku', BookOpenCheck, 'accounting', [read('invoice'), write('quotation')]),
  soon('xero', Wallet, 'accounting', [read('invoice'), write('contact')]),
  soon('zoho-books', Receipt, 'accounting', [read('invoice'), write('quotation')]),
  soon('zoho-crm', ContactRound, 'crm', [read('findContact'), write('addLead')]),
  soon('hubspot', Users, 'crm', [read('findContact'), write('addLead')]),
  soon('woocommerce', ShoppingCart, 'commerce', [read('orderStatus'), read('productStock')]),
  soon('easystore', Store, 'commerce', [read('orderStatus'), read('productStock')]),
  soon('storehub', Store, 'commerce', [read('productStock'), read('member')]),
  soon('billplz', CreditCard, 'payments', [write('paymentLink'), read('paymentStatus')]),
  {
    id: 'custom-mcp',
    icon: Plug,
    category: 'custom',
    edition: 'enterprise',
    available: true,
    tools: [],
  },
];

export function findConnector(id: string | undefined): CatalogConnector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

/**
 * What a gallery card shows. `linked`: an extension provides the connector's page (no badge here;
 * that page shows its own state).
 */
export type ConnectorStatus =
  'connected' | 'attention' | 'notConnected' | 'comingSoon' | 'enterprise' | 'linked';

export function connectorStatus(
  c: CatalogConnector,
  google: GoogleCalendarState | undefined,
  extensionLink: string | undefined,
): ConnectorStatus {
  if (extensionLink) return 'linked';
  if (c.edition === 'enterprise') return 'enterprise';
  if (!c.available) return 'comingSoon';
  if (c.id === 'google-calendar') {
    if (google === 'connected') return 'connected';
    if (google === 'expired' || google === 'unavailable') return 'attention';
  }
  return 'notConnected';
}

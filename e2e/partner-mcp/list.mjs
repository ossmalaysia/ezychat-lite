// A signed TEST connector list describing the partners of the local partner MCP test server.
// TEST ONLY: never published. The key pair is generated at start; the app trusts it only through
// the dev switch EZYCHAT_CONNECTOR_LIST_TEST_KEY (base64 raw Ed25519 public key).
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

const svg = (letter, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="42" font-family="Arial, sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`;

/** Icons served under icons/ next to the list: file name → SVG text. */
export const TEST_ICONS = {
  'test-lejar.svg': svg('L', '#1d6f42'),
  'test-kedai.svg': svg('K', '#7c3aed'),
  'test-gudang.svg': svg('G', '#b45309'),
  'test-bayar.svg': svg('B', '#0369a1'),
  'test-open.svg': svg('O', '#475569'),
};

function icon(file) {
  const bytes = Buffer.from(TEST_ICONS[file], 'utf8');
  return { file, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}

const READ_TOOLS = [
  {
    name: 'find_invoice',
    title: { en: 'Find invoices', ms: 'Cari invois', 'zh-CN': '查找发票' },
    description: {
      en: "Look up the customer's invoices by invoice number or customer name: number, status and total.",
    },
    instructions: {
      en: 'Tell the customer only the invoice numbers and totals this tool returns.',
    },
    access: 'read',
    guards: { limits: { perChat: 20 } },
  },
  {
    name: 'check_stock',
    title: { en: 'Check stock', ms: 'Semak stok', 'zh-CN': '查询库存' },
    description: {
      en: 'Check whether a product is in stock by SKU or name: SKU, name and quantity.',
    },
    access: 'read',
  },
  {
    name: 'list_price_lists',
    title: { en: 'List price lists' },
    description: { en: 'The price lists of the business (for the settings form).' },
    access: 'read',
  },
];

const WRITE_TOOL = {
  name: 'create_quotation',
  title: { en: 'Create quotation', ms: 'Buat sebut harga', 'zh-CN': '创建报价单' },
  description: { en: 'Create a draft quotation for the customer for one product.' },
  instructions: {
    en: 'Use the SKU from Check stock, the customer name and email the customer gave, and a delivery time within business hours.',
  },
  access: 'write',
  guards: {
    confirmFirst: true,
    valueFrom: { sku: 'check_stock' },
    fromCustomer: ['customer_name', 'customer_email'],
    within: { delivery_at: 'hours' },
    limits: { perChat: 2, perDay: 20 },
  },
};

const SETTINGS = [
  {
    id: 'priceList',
    type: 'calendarPicker',
    from: 'list_price_lists',
    label: { en: 'Price list' },
  },
  { id: 'hours', type: 'timeRange', label: { en: 'Delivery hours' }, default: ['09:00', '18:00'] },
  { id: 'days', type: 'days', label: { en: 'Delivery days' }, default: [1, 2, 3, 4, 5] },
  {
    id: 'currency',
    type: 'select',
    label: { en: 'Currency' },
    options: [
      { value: 'MYR', label: { en: 'Ringgit (MYR)' } },
      { value: 'SGD', label: { en: 'Singapore dollar (SGD)' } },
    ],
    default: 'MYR',
  },
  { id: 'discounts', type: 'toggle', label: { en: 'Mention discounts' }, default: false },
  { id: 'note', type: 'text', label: { en: 'Note for the AI' } },
];

const base = (id, name, summary) => ({
  id,
  schemaVersion: 1,
  minAppVersion: '0.1.0',
  kind: 'mcp',
  editions: ['lite', 'enterprise'],
  name,
  summary: { en: summary },
  description: {
    en: `${summary} Test partner of the EzyChat partner MCP test server (demo data).`,
  },
  category: 'accounting',
  icon: icon(`${id}.svg`),
  publisher: 'EzyChat test partners',
  homepage: 'https://ezychat.ai/',
  privacy: { en: `Your invoice and stock look-ups go between your computer and ${name}.` },
  skill: {
    en: `${name} holds the invoices and stock of this business. Never promise a delivery date it did not return.`,
  },
  settings: SETTINGS,
});

/** One test partner entry per sign-in type, pointing at the server on `origin`. */
export function partnerEntries(origin) {
  return [
    {
      ...base(
        'test-lejar',
        'Lejar Accounting (test)',
        'Invoices, stock and quotations; sign in with OAuth.',
      ),
      mcp: { url: `${origin}/oauth/mcp` },
      auth: { type: 'oauth', scopes: ['invoices.read', 'stock.read', 'quotes.write'] },
      tools: [...READ_TOOLS, WRITE_TOOL],
    },
    {
      ...base('test-kedai', 'Kedai CRM (test)', 'Invoices and stock with an API key.'),
      mcp: { url: `${origin}/api-key/mcp` },
      auth: {
        type: 'api_key',
        label: { en: 'API key' },
        help: 'https://ezychat.ai/',
        header: { name: 'Authorization', value: 'Bearer {key}' },
      },
      tools: [...READ_TOOLS, WRITE_TOOL],
    },
    {
      ...base(
        'test-gudang',
        'Gudang Stock (test)',
        'Stock look-ups with an account, username and password.',
      ),
      mcp: { url: `${origin}/credentials/mcp` },
      auth: {
        type: 'credentials',
        fields: [
          { id: 'account', label: { en: 'Account' }, secret: false },
          { id: 'username', label: { en: 'Username' }, secret: false },
          { id: 'password', label: { en: 'Password' }, secret: true },
        ],
        headers: [
          { name: 'Authorization', value: 'Basic {username:password}' },
          { name: 'X-Account', value: '{account}' },
        ],
      },
      tools: READ_TOOLS,
    },
    {
      ...base(
        'test-bayar',
        'Bayar Payments (test)',
        'Invoices with your own OAuth app (client ID and secret).',
      ),
      mcp: { url: `${origin}/oauth-own-app/mcp` },
      auth: { type: 'oauth_own_app', scopes: ['invoices.read'] },
      tools: READ_TOOLS,
    },
    {
      ...base('test-open', 'Open Catalogue (test)', 'A public catalogue: no sign-in.'),
      mcp: { url: `${origin}/none/mcp` },
      auth: { type: 'none' },
      tools: READ_TOOLS.slice(1),
    },
  ];
}

/** The built-in Google Calendar entry, so the gallery keeps it while the test list is used. */
const GOOGLE_CALENDAR = {
  id: 'google-calendar',
  schemaVersion: 1,
  minAppVersion: '0.1.0',
  kind: 'builtin',
  builtinId: 'google-calendar',
  editions: ['lite', 'enterprise'],
  name: 'Google Calendar',
  summary: { en: 'Let the AI check free times and book appointments.' },
  description: { en: 'Let the AI check free times in your Google Calendar and book appointments.' },
  category: 'calendar',
  publisher: 'Google',
};

/** A new Ed25519 key pair: the public key as base64 raw 32 bytes (the app's key format). */
export function createListKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { privateKey, publicKeyBase64: Buffer.from(raw).toString('base64') };
}

/** The signed list: exact bytes and the base64 Ed25519 signature of those bytes. */
export function buildSignedList({ origin, privateKey, sequence = 1, generatedAt = new Date() }) {
  const list = {
    format: 1,
    generatedAt: generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    sequence,
    entries: [GOOGLE_CALENDAR, ...partnerEntries(origin)],
  };
  const bytes = Buffer.from(JSON.stringify(list, null, 2), 'utf8');
  return { bytes, signature: sign(null, bytes, privateKey).toString('base64') };
}

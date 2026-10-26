import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import type { ConnectorEntry, ConnectorTool } from '@ezychat/shared';
import { ConnectorDetailPage } from './ConnectorDetailPage';
import {
  DEFAULT_LIST,
  agent,
  connection,
  entry,
  gallery,
  listed,
  renderAt,
  stubServer,
  world,
  writes,
  type World,
} from './connectors.test.helpers';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

beforeAll(() => {
  // Radix Select uses pointer capture and scrollIntoView, which jsdom lacks.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const TOOLS: ConnectorTool[] = [
  {
    name: 'find_invoice',
    title: { en: 'Find invoices', ms: 'Cari invois' },
    description: { en: 'Looks up invoices of the customer.' },
    access: 'read',
  },
  {
    name: 'create_quotation',
    title: { en: 'Create quotations' },
    description: { en: 'Adds a quotation in Lejar.' },
    access: 'write',
    guards: {
      confirmFirst: true,
      valueFrom: { item: 'find_invoice' },
      fromCustomer: ['customer.name', 'customer.email', 'buyer.name'],
      within: { start: 'hours', day: 'days' },
      limits: { perChat: 2, perDay: 20 },
    },
  },
  {
    name: 'add_note',
    title: { en: 'Add notes' },
    description: { en: 'Writes a note on the customer.' },
    access: 'write',
    guards: { limits: { perDay: 5 } },
  },
];

const SETTINGS: NonNullable<ConnectorEntry['settings']> = [
  {
    id: 'currency',
    type: 'select',
    label: { en: 'Currency' },
    options: [
      { value: 'MYR', label: { en: 'Ringgit' } },
      { value: 'SGD', label: { en: 'Singapore dollar' } },
    ],
    default: 'MYR',
  },
  { id: 'tax', type: 'toggle', label: { en: 'Include tax' }, default: true },
  {
    id: 'note',
    type: 'text',
    label: { en: 'Quotation note' },
    hint: { en: 'Shown on every quotation.' },
    required: true,
  },
  { id: 'validDays', type: 'number', label: { en: 'Valid for days' } },
  { id: 'days', type: 'days', label: { en: 'Working days' }, default: [1, 2, 3, 4, 5] },
  { id: 'hours', type: 'timeRange', label: { en: 'Working hours' }, default: ['09:00', '18:00'] },
  { id: 'calendar', type: 'calendarPicker', label: { en: 'Calendar' }, from: 'find_invoice' },
];

const LEJAR = entry('lejar', {
  name: 'Lejar Accounting',
  publisher: 'Lejar Sdn Bhd',
  homepage: 'https://lejar.example',
  category: 'accounting',
  description: { en: 'Invoices and quotations from Lejar.', ms: 'Invois dan sebut harga.' },
  privacy: { en: 'Your invoices go between your computer and Lejar.' },
  auth: { type: 'oauth', scopes: [] },
  tools: TOOLS,
  settings: SETTINGS,
});
const KEDAI = entry('kedai', {
  name: 'Kedai CRM',
  publisher: 'Kedai',
  category: 'crm',
  privacy: { en: 'Your contacts go between your computer and Kedai.' },
  auth: {
    type: 'api_key',
    label: { en: 'Kedai API key' },
    help: 'https://kedai.example/help',
    header: { name: 'Authorization', value: 'Bearer {key}' },
  },
});
const STOK = entry('stok', {
  name: 'Stok Awan',
  auth: {
    type: 'credentials',
    fields: [
      { id: 'tenant', label: { en: 'Account ID' }, secret: false },
      { id: 'apiKey', label: { en: 'Secret key' }, hint: { en: 'In Settings.' }, secret: true },
    ],
    headers: [{ name: 'X-Key', value: '{apiKey}' }],
    help: 'https://stok.example/help',
  },
});
const BUKU = entry('buku', {
  name: 'Buku Kira',
  publisher: 'Buku',
  auth: { type: 'oauth_own_app', scopes: [], help: 'https://buku.example/app' },
});
const CUACA = entry('cuaca', { name: 'Cuaca', publisher: 'Cuaca', auth: { type: 'none' } });

const withPartners = (patch: Partial<World> = {}, connections: Record<string, unknown> = {}) =>
  world({
    gallery: gallery([
      ...DEFAULT_LIST,
      ...[LEJAR, KEDAI, STOK, BUKU, CUACA].map((e) =>
        listed(e, { connection: (connections[e.id] as never) ?? null }),
      ),
    ]),
    ...patch,
  });

const page = (path: string) => renderAt(path, <ConnectorDetailPage />);
const tab = () => ({ opener: {} as unknown, location: { href: '' }, close: vi.fn() });

describe('Partner connector: Overview', () => {
  it('shows the publisher, what the AI can do and the privacy line before Connect', async () => {
    stubServer(withPartners());
    page('/admin/connectors/lejar');
    expect(await screen.findByRole('heading', { name: 'Lejar Accounting' })).toBeTruthy();
    expect(screen.getByText('By Lejar Sdn Bhd · Accounting')).toBeTruthy();
    expect(screen.getByTestId('publisher-homepage').getAttribute('href')).toBe(
      'https://lejar.example',
    );
    expect(screen.getByText('Invoices and quotations from Lejar.')).toBeTruthy();
    const tools = screen.getByTestId('entry-tools');
    expect(within(tools).getByText('Find invoices')).toBeTruthy();
    expect(within(tools).getByText('Look-up')).toBeTruthy();
    expect(within(tools).getAllByText('Changes data')).toHaveLength(2);
    expect(screen.getByTestId('privacy-before-connect').textContent).toContain(
      'Your invoices go between your computer and Lejar.',
    );
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Overview',
      'Settings',
      'Activity',
    ]);
    // Technical details stay behind a button for the developer.
    const user = userEvent.setup();
    expect(screen.queryByTestId('developer-details')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show details for your developer' }));
    const details = screen.getByTestId('developer-details');
    expect(within(details).getByText('https://lejar.example/mcp')).toBeTruthy();
    expect(within(details).getByText('Sign in on the partner’s page (OAuth)')).toBeTruthy();
    expect(within(details).getByText('lejar, schema 1')).toBeTruthy();
  });

  it('shows the entry texts in the language of the app', async () => {
    const { i18n } = await import('@/i18n');
    stubServer(withPartners());
    await i18n.changeLanguage('ms');
    try {
      page('/admin/connectors/lejar');
      expect(await screen.findByText('Invois dan sebut harga.')).toBeTruthy();
      expect(screen.getByText('Cari invois')).toBeTruthy();
      // English is the fallback of a text without Malay.
      expect(screen.getByText('Create quotations')).toBeTruthy();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('signs in with OAuth: opens a tab in the click, waits for the partner and shows the account', async () => {
    const w = withPartners({
      mcpProgress: [
        { status: 'pending', problem: null },
        { status: 'done', problem: null },
      ],
    });
    const fetchMock = stubServer(w);
    const t = tab();
    const open = vi.spyOn(window, 'open').mockReturnValue(t as unknown as Window);
    page('/admin/connectors/lejar');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Lejar Accounting' }));
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    await waitFor(() => expect(t.location.href).toBe('https://partner.example/authorize?x=1'));
    expect(t.opener).toBeNull();
    const waiting = await screen.findByTestId('partner-waiting');
    expect(within(waiting).getByText('Waiting for you to sign in')).toBeTruthy();
    expect(await screen.findByText('owner@kopiapong.my', {}, { timeout: 4000 })).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Lejar Accounting connected');
    expect(screen.queryByTestId('partner-waiting')).toBeNull();
    expect(writes(fetchMock)).toContain('POST /api/connectors/mcp/lejar/connect');
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(
      '/api/connectors/mcp/lejar/connect/req-9',
    );
  });

  it('offers the sign-in page when the browser blocked the tab, and can cancel', async () => {
    stubServer(withPartners({ mcpProgress: [{ status: 'pending', problem: null }] }));
    vi.spyOn(window, 'open').mockReturnValue(null);
    page('/admin/connectors/lejar');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Lejar Accounting' }));
    const waiting = await screen.findByTestId('partner-waiting');
    expect(within(waiting).getByText(/blocked the sign-in tab/)).toBeTruthy();
    expect(
      within(waiting)
        .getByRole('link', { name: /Open the sign-in page/ })
        .getAttribute('href'),
    ).toBe('https://partner.example/authorize?x=1');
    await user.click(within(waiting).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('partner-waiting')).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect Lejar Accounting' })).toBeTruthy();
  });

  it.each([
    ['cancelled', 'Sign-in cancelled'],
    ['unreachable', 'Could not reach Lejar Accounting'],
    ['expired', 'The sign-in took too long. Try again.'],
  ] as const)('says why the sign-in failed (%s) and offers Try again', async (problem, text) => {
    stubServer(withPartners({ mcpProgress: [{ status: 'failed', problem }] }));
    vi.spyOn(window, 'open').mockReturnValue(tab() as unknown as Window);
    page('/admin/connectors/lejar');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Lejar Accounting' }));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('closes the tab and shows the reason when the server refuses to start', async () => {
    stubServer(withPartners({ fail: { 'POST /connectors/mcp/lejar/connect': 500 } }));
    const t = tab();
    vi.spyOn(window, 'open').mockReturnValue(t as unknown as Window);
    page('/admin/connectors/lejar');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Lejar Accounting' }));
    expect(await screen.findByText('Boom')).toBeTruthy();
    expect(t.close).toHaveBeenCalled();
  });

  it('connects a server without sign-in with one click', async () => {
    const fetchMock = stubServer(withPartners());
    page('/admin/connectors/cuaca');
    const user = userEvent.setup();
    expect(await screen.findByText('EzyChat stores nothing secret for Cuaca.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Connect Cuaca' }));
    expect(await screen.findByTestId('partner-connected')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Cuaca connected');
    expect(writes(fetchMock)).toEqual(['POST /api/connectors/mcp/cuaca/connect']);
  });

  it('tests and disconnects a connected partner after a confirmation', async () => {
    const w = withPartners(
      {},
      { lejar: connection('connected', { account: 'owner@kopiapong.my' }) },
    );
    const fetchMock = stubServer(w);
    page('/admin/connectors/lejar');
    const user = userEvent.setup();
    expect(await screen.findByText('owner@kopiapong.my')).toBeTruthy();
    expect(screen.getByText(/Connected 3 hours ago/)).toBeTruthy();
    await user.click(screen.getByTestId('partner-test'));
    expect(await screen.findByText('The connection works. 3 tools are ready.')).toBeTruthy();
    w.mcpTest = () => ({ ok: false, tools: [], problem: 'unreachable' });
    await user.click(screen.getByTestId('partner-test'));
    expect(await screen.findByText('Could not reach Lejar Accounting')).toBeTruthy();
    await user.click(screen.getByTestId('partner-disconnect'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/The settings of each AI agent stay/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('button', { name: 'Connect Lejar Accounting' })).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Lejar Accounting disconnected');
    expect(writes(fetchMock)).toEqual([
      'POST /api/connectors/mcp/lejar/test',
      'POST /api/connectors/mcp/lejar/test',
      'POST /api/connectors/mcp/lejar/disconnect',
    ]);
    expect(
      JSON.parse(String(fetchMock.mock.calls.find((c) => c[0].endsWith('/test'))![1]!.body)),
    ).toEqual({ fields: {} });
  });

  it('asks to sign in again, and warns when the partner cannot be reached', async () => {
    stubServer(
      withPartners({}, { lejar: connection('needs_sign_in', { account: 'owner@kopiapong.my' }) }),
    );
    page('/admin/connectors/lejar');
    expect(
      await screen.findByText('Sign in again', { selector: 'p, div, span, strong' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy();
    expect(screen.getAllByText('Needs attention').length).toBeGreaterThan(0);
    cleanup();
    stubServer(withPartners({}, { lejar: connection('unreachable') }));
    page('/admin/connectors/lejar');
    expect(await screen.findByText('Could not reach Lejar Accounting')).toBeTruthy();
  });

  it('flags a connector that left the list; it keeps working but cannot be connected again', async () => {
    stubServer(
      world({
        gallery: gallery([
          listed(KEDAI, {
            delisted: true,
            connection: connection('connected', { keyEnd: 'x9z1' }),
          }),
        ]),
      }),
    );
    page('/admin/connectors/kedai');
    expect(await screen.findByTestId('delisted-note')).toBeTruthy();
    expect(screen.getByText('This connector is no longer available')).toBeTruthy();
    expect(screen.getAllByText('No longer available').length).toBeGreaterThan(0);
    expect(screen.getByText('Key ending in x9z1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Replace key' })).toBeNull();
    expect(screen.getByTestId('partner-disconnect')).toBeTruthy();
  });

  it('hides a removed connector that is no longer connected', async () => {
    stubServer(world({ gallery: gallery([listed(KEDAI, { delisted: true })]) }));
    page('/admin/connectors/kedai');
    expect(await screen.findByText('This connector does not exist.')).toBeTruthy();
  });

  it('explains an entry that needs a newer EzyChat or Enterprise', async () => {
    stubServer(world({ gallery: gallery([listed(KEDAI, { fit: 'needsUpdate' })]) }));
    page('/admin/connectors/kedai');
    expect(await screen.findByTestId('needs-update')).toBeTruthy();
    expect(
      screen.getByText('This connector needs EzyChat 0.1.0 or later. This computer has 0.1.62.'),
    ).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('partner-connect')).toBeNull();
    cleanup();
    stubServer(world({ gallery: gallery([listed(KEDAI, { fit: 'enterprise' })]) }));
    page('/admin/connectors/kedai');
    expect(await screen.findByText('This connector is part of EzyChat Enterprise.')).toBeTruthy();
    expect(screen.getByTestId('upgrade-enterprise')).toBeTruthy();
    expect(screen.queryByTestId('partner-connect')).toBeNull();
  });

  it('shows a load error with Retry', async () => {
    stubServer(world({ fail: { 'GET /connectors/list': 500 } }));
    page('/admin/connectors/kedai');
    expect(await screen.findByText('Boom')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('Partner connector: key and form sign-ins', () => {
  it('tests an API key, says when it is refused, and saves it showing only its end', async () => {
    const w = withPartners({
      mcpTest: (_id, fields) =>
        fields.key === 'kd_good1234'
          ? { ok: true, tools: ['find_invoice', 'check_stock'], problem: null }
          : { ok: false, tools: [], problem: 'refused' },
    });
    const fetchMock = stubServer(w);
    page('/admin/connectors/kedai');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect with an API key' }));
    const dialog = await screen.findByTestId('connect-dialog');
    const input = within(dialog).getByLabelText('Kedai API key') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(
      within(dialog)
        .getByRole('link', { name: /Where do I find my Kedai CRM key/ })
        .getAttribute('href'),
    ).toBe('https://kedai.example/help');
    // Empty: nothing is sent.
    await user.click(screen.getByTestId('connect-test'));
    expect(within(dialog).getByText('Fill in this field.')).toBeTruthy();
    await user.type(input, 'kd_bad');
    await user.click(screen.getByTestId('connect-test'));
    expect(
      await within(dialog).findByText(
        'Kedai CRM refused this key. Check that you copied all of it.',
      ),
    ).toBeTruthy();
    await user.clear(input);
    await user.type(input, 'kd_good1234');
    expect(within(dialog).queryByText(/refused this key/)).toBeNull();
    await user.click(screen.getByTestId('connect-test'));
    expect(
      await within(dialog).findByText('The connection works. 2 tools are ready.'),
    ).toBeTruthy();
    await user.click(screen.getByTestId('connect-save'));
    expect(await screen.findByText('Key ending in 1234')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Kedai CRM connected');
    expect(screen.queryByTestId('connect-dialog')).toBeNull();
    const bodies = fetchMock.mock.calls
      .filter((c) => c[1]?.method === 'POST')
      .map((c) => [c[0], JSON.parse(String(c[1]!.body))]);
    expect(bodies).toEqual([
      ['/api/connectors/mcp/kedai/test', { fields: { key: 'kd_bad' } }],
      ['/api/connectors/mcp/kedai/test', { fields: { key: 'kd_good1234' } }],
      ['/api/connectors/mcp/kedai/connect', { fields: { key: 'kd_good1234' } }],
    ]);
  });

  it('shows the problem the server names when Test or Save fails', async () => {
    const w = withPartners({
      problems: {
        'POST /connectors/mcp/kedai/test': 'refused',
        'POST /connectors/mcp/kedai/connect': 'unreachable',
      },
    });
    stubServer(w);
    page('/admin/connectors/kedai');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect with an API key' }));
    const dialog = await screen.findByTestId('connect-dialog');
    await user.type(within(dialog).getByLabelText('Kedai API key'), 'kd_x');
    await user.click(screen.getByTestId('connect-test'));
    expect(await within(dialog).findByText(/Kedai CRM refused this key/)).toBeTruthy();
    await user.click(screen.getByTestId('connect-save'));
    expect(await within(dialog).findByText('Could not reach Kedai CRM')).toBeTruthy();
    expect(within(dialog).queryByText('Partner said no')).toBeNull();
    // A connected server that now refuses: Test connection says so in plain words.
    cleanup();
    stubServer(
      withPartners(
        { problems: { 'POST /connectors/mcp/lejar/test': 'missing_tools' } },
        { lejar: connection('connected') },
      ),
    );
    page('/admin/connectors/lejar');
    await user.click(await screen.findByTestId('partner-test'));
    expect(
      await screen.findByText(
        'The server of Lejar Accounting does not offer the tools this connector needs. Tell Lejar Sdn Bhd.',
      ),
    ).toBeTruthy();
  });

  it('explains a refused server address when connecting without sign-in', async () => {
    stubServer(withPartners({ problems: { 'POST /connectors/mcp/cuaca/connect': 'not_https' } }));
    page('/admin/connectors/cuaca');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Cuaca' }));
    expect(
      await screen.findByText(
        'The server address of Cuaca is not secure (https), so EzyChat did not connect.',
      ),
    ).toBeTruthy();
  });

  it('says when Save is refused or the server cannot be reached', async () => {
    const w = withPartners({
      mcpConnect: (_id, fields) => ({
        authorizationUrl: null,
        requestId: null,
        connection: connection(fields.key === 'down' ? 'unreachable' : 'needs_sign_in'),
      }),
    });
    stubServer(w);
    page('/admin/connectors/kedai');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect with an API key' }));
    const dialog = await screen.findByTestId('connect-dialog');
    await user.type(within(dialog).getByLabelText('Kedai API key'), 'nope');
    await user.click(screen.getByTestId('connect-save'));
    expect(await within(dialog).findByText(/refused this key/)).toBeTruthy();
    await user.clear(within(dialog).getByLabelText('Kedai API key'));
    await user.type(within(dialog).getByLabelText('Kedai API key'), 'down');
    await user.click(screen.getByTestId('connect-save'));
    expect(await within(dialog).findByText('Could not reach Kedai CRM')).toBeTruthy();
  });

  it('fills the declared account fields, secret ones hidden, and shows the others once connected', async () => {
    const fetchMock = stubServer(
      withPartners({
        mcpConnect: (_id, fields) => ({
          authorizationUrl: null,
          requestId: null,
          connection: connection('connected', {
            keyEnd: fields.apiKey!.slice(-4),
            fields: { tenant: fields.tenant! },
          }),
        }),
      }),
    );
    page('/admin/connectors/stok');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Connect with your account details' }),
    );
    const dialog = await screen.findByTestId('connect-dialog');
    expect((within(dialog).getByLabelText('Account ID') as HTMLInputElement).type).toBe('text');
    expect((within(dialog).getByLabelText('Secret key') as HTMLInputElement).type).toBe('password');
    expect(within(dialog).getByText('In Settings.')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Account ID'), 'kopi-01');
    await user.click(screen.getByTestId('connect-save'));
    expect(within(dialog).getByText('Fill in this field.')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Secret key'), 'sk_abcd9876');
    await user.click(screen.getByTestId('connect-save'));
    expect(await screen.findByText('Key ending in 9876')).toBeTruthy();
    expect(screen.getByText('kopi-01')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change details' })).toBeTruthy();
    const save = fetchMock.mock.calls.find((c) => c[0] === '/api/connectors/mcp/stok/connect')!;
    expect(JSON.parse(String(save[1]!.body))).toEqual({
      fields: { tenant: 'kopi-01', apiKey: 'sk_abcd9876' },
    });
  });

  it('takes your own app details, then opens the partner sign-in in the same click', async () => {
    const fetchMock = stubServer(
      withPartners({ mcpProgress: [{ status: 'pending', problem: null }] }),
    );
    const t = tab();
    const open = vi.spyOn(window, 'open').mockReturnValue(t as unknown as Window);
    page('/admin/connectors/buku');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect with your own app' }));
    const dialog = await screen.findByTestId('connect-dialog');
    expect(screen.queryByTestId('connect-test')).toBeNull();
    expect(
      within(dialog).getByRole('link', { name: 'How do I create the app?' }).getAttribute('href'),
    ).toBe('https://buku.example/app');
    await user.type(within(dialog).getByLabelText('Client ID'), 'client-1');
    await user.type(within(dialog).getByLabelText('Client secret'), 'secret-2');
    await user.click(screen.getByRole('button', { name: 'Save and sign in' }));
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    await waitFor(() => expect(t.location.href).toBe('https://partner.example/authorize?x=1'));
    expect(await screen.findByTestId('partner-waiting')).toBeTruthy();
    expect(screen.queryByTestId('connect-dialog')).toBeNull();
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/connectors/mcp/buku/connect')!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({
      fields: { clientId: 'client-1', clientSecret: 'secret-2' },
    });
  });
});

describe('Partner connector: Settings', () => {
  const connected = () =>
    withPartners(
      { agents: [agent(1, 'Aina'), agent(2, 'Badrul')] },
      { lejar: connection('connected', { account: 'owner@kopiapong.my' }) },
    );

  it('asks to connect first', async () => {
    stubServer(withPartners());
    page('/admin/connectors/lejar?tab=settings');
    const user = userEvent.setup();
    expect(await screen.findByText('Connect Lejar Accounting first')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Go to Overview' }));
    expect(screen.getByTestId('location').textContent).toBe('/admin/connectors/lejar?tab=overview');
  });

  it('shows the form with the defaults, look-ups on and tools that change data off', async () => {
    stubServer(connected());
    page('/admin/connectors/lejar?tab=settings&agent=2');
    const card = await screen.findByTestId('partner-agent-settings');
    expect(within(card).getByText('Lejar Accounting for Badrul')).toBeTruthy();
    // A picker with 2+ agents; `&agent=2` picks Badrul.
    expect(screen.getByLabelText('Settings for').textContent).toContain('Badrul');
    expect(await within(card).findByText('Quotation note')).toBeTruthy();
    expect(within(card).getByTestId('setting-currency').textContent).toContain('Ringgit');
    expect(within(card).getByTestId('setting-tax').getAttribute('aria-checked')).toBe('true');
    expect(within(card).getByText('Shown on every quotation.')).toBeTruthy();
    const days = within(card).getByTestId('setting-days');
    expect(
      within(days)
        .getAllByRole('checkbox')
        .map((c) => c.getAttribute('aria-checked')),
    ).toEqual(['true', 'true', 'true', 'true', 'true', 'false', 'false']);
    expect((within(card).getByLabelText('From') as HTMLInputElement).value).toBe('09:00');
    expect((within(card).getByLabelText('To') as HTMLInputElement).value).toBe('18:00');
    expect(within(card).getByTestId('tool-switch-find_invoice').getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(
      within(card).getByTestId('tool-switch-create_quotation').getAttribute('aria-checked'),
    ).toBe('false');
    expect(within(card).getByTestId('tool-switch-add_note').getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(
      within(card).getByText('Tools that change data start off. Look-ups start on.'),
    ).toBeTruthy();
  });

  it('lists the rules the AI always follows in plain words', async () => {
    stubServer(connected());
    page('/admin/connectors/lejar?tab=settings');
    const rules = await screen.findByTestId('guard-rules');
    const text = rules.textContent!;
    expect(text).toContain('Rules the AI always follows');
    expect(text).toContain('only when Lejar Sdn Bhd confirms it');
    expect(text).toContain('Never undoes anything');
    expect(text).toContain('Tools that change data stay off until you switch them on.');
    expect(text).toContain('Create quotations:');
    expect(text).toContain('Asks the customer to confirm first');
    expect(text).toContain('Uses only values that “Find invoices” found in this chat.');
    expect(text).toContain('Takes the customer’s name and email from the saved contact');
    expect(text).toContain('Only within the Working hours and Working days set above.');
    expect(text).toContain('At most 2 per chat and 20 a day.');
    expect(text).toContain('Add notes:');
    expect(text).toContain('At most 5 a day.');
    expect(text).not.toContain('Find invoices:');
  });

  it('checks the form, then saves the settings and tool switches of the agent', async () => {
    const w = connected();
    const fetchMock = stubServer(w);
    page('/admin/connectors/lejar?tab=settings&agent=2');
    const user = userEvent.setup();
    const card = await screen.findByTestId('partner-agent-settings');
    await within(card).findByText('Quotation note');
    const save = within(card).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(within(card).getByTestId('tool-switch-create_quotation'));
    fireEvent.change(within(card).getByLabelText('From'), { target: { value: '19:00' } });
    await user.click(save);
    expect(within(card).getByText('Fill in this setting.')).toBeTruthy();
    expect(within(card).getByText('The end time must be after the start time.')).toBeTruthy();
    expect(writes(fetchMock)).toEqual([]);
    fireEvent.change(within(card).getByLabelText('From'), { target: { value: '08:30' } });
    await user.type(within(card).getByLabelText('Quotation note'), 'Thank you');
    await user.type(within(card).getByLabelText('Valid for days'), '14');
    await user.click(within(card).getByRole('checkbox', { name: /Sat/ }));
    await user.click(within(card).getByTestId('setting-currency'));
    await user.click(await screen.findByRole('option', { name: 'Singapore dollar' }));
    await user.click(within(card).getByTestId('setting-calendar'));
    await user.click(await screen.findByRole('option', { name: 'Team calendar' }));
    await user.click(save);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved'));
    expect(writes(fetchMock)).toEqual(['PUT /api/connectors/mcp/lejar/agents/2']);
    expect(w.mcpSettings['lejar:2']).toEqual({
      settings: {
        currency: 'SGD',
        tax: true,
        note: 'Thank you',
        validDays: 14,
        days: [1, 2, 3, 4, 5, 6],
        hours: ['08:30', '18:00'],
        calendar: 'team',
      },
      tools: { find_invoice: true, create_quotation: true, add_note: false },
    });
    expect(
      fetchMock.mock.calls.some(
        (c) => c[0] === '/api/connectors/mcp/lejar/choices/calendar?agentId=2',
      ),
    ).toBe(true);
    expect(save.disabled).toBe(true);
  });

  it('says when the choices cannot be loaded, and retries', async () => {
    const w = connected();
    w.fail = { 'GET /connectors/mcp/lejar/choices/calendar': 500 };
    stubServer(w);
    page('/admin/connectors/lejar?tab=settings');
    const user = userEvent.setup();
    expect(await screen.findByText('Could not load the choices.')).toBeTruthy();
    w.fail = {};
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('Could not load the choices.')).toBeNull());
  });

  it('keeps saved values and says when Save fails', async () => {
    const w = connected();
    w.mcpSettings['lejar:1'] = {
      settings: { note: 'Saved note', validDays: 7 },
      tools: { find_invoice: false, add_note: true },
    };
    w.fail = { 'PUT /connectors/mcp/lejar/agents/1': 500 };
    stubServer(w);
    page('/admin/connectors/lejar?tab=settings');
    const user = userEvent.setup();
    const card = await screen.findByTestId('partner-agent-settings');
    expect(((await within(card).findByLabelText('Quotation note')) as HTMLInputElement).value).toBe(
      'Saved note',
    );
    expect((within(card).getByLabelText('Valid for days') as HTMLInputElement).value).toBe('7');
    expect(within(card).getByTestId('tool-switch-find_invoice').getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(within(card).getByTestId('tool-switch-add_note').getAttribute('aria-checked')).toBe(
      'true',
    );
    await user.click(within(card).getByTestId('tool-switch-find_invoice'));
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Boom')).toBeTruthy();
  });
});

describe('Partner connector: Activity', () => {
  it('lists look-ups, actions, refusals with the reason and failures, never chat text', async () => {
    const now = Date.now();
    stubServer(
      withPartners(
        {
          mcpActivity: {
            lejar: [
              {
                id: 1,
                at: now - 300_000,
                kind: 'checked',
                agentName: 'Aina',
                customer: 'Siti',
                tool: 'find_invoice',
                reason: null,
              },
              {
                id: 2,
                at: now - 600_000,
                kind: 'refused',
                agentName: 'Aina',
                customer: 'Siti',
                tool: 'create_quotation',
                reason: 'confirm_first',
              },
              {
                id: 3,
                at: now - 900_000,
                kind: 'failed',
                agentName: 'Aina',
                customer: 'Ah Kow',
                tool: 'create_quotation',
                reason: 'unreachable',
              },
              {
                id: 4,
                at: now - 1_200_000,
                kind: 'done',
                agentName: 'Badrul',
                customer: 'Mei Ling',
                tool: 'old_tool',
                reason: null,
              },
            ],
          },
        },
        { lejar: connection('connected') },
      ),
    );
    page('/admin/connectors/lejar?tab=activity');
    const list = await screen.findByTestId('partner-activity');
    expect(within(list).getByText('Find invoices · Siti')).toBeTruthy();
    expect(within(list).getByText('Looked up')).toBeTruthy();
    expect(within(list).getByText('Refused')).toBeTruthy();
    expect(
      within(list).getByText(
        'The customer had not confirmed yet. The AI asked the customer first.',
      ),
    ).toBeTruthy();
    expect(within(list).getByText('Failed')).toBeTruthy();
    expect(
      within(list).getByText('Lejar Sdn Bhd did not answer. The AI handed the chat to your team.'),
    ).toBeTruthy();
    expect(within(list).getByText('old_tool · Mei Ling')).toBeTruthy();
    expect(within(list).getByText('Done')).toBeTruthy();
    expect(within(list).getByText('Aina · 5 minutes ago')).toBeTruthy();
  });

  it('says when there is nothing yet', async () => {
    stubServer(withPartners());
    page('/admin/connectors/lejar?tab=activity');
    expect(await screen.findByText('Nothing yet.')).toBeTruthy();
    expect(
      screen.getByText(
        'What the AI looked up and did in Lejar Accounting. Chat text is never kept here.',
      ),
    ).toBeTruthy();
  });
});

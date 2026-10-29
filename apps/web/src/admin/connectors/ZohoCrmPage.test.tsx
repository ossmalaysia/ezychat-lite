import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { DEFAULT_ZOHO_CRM_SETTINGS } from '@ezychat/shared';
import { AgentConnectorsCard } from './AgentConnectorsCard';
import { ConnectorDetailPage } from './ConnectorDetailPage';
import { ConnectorsGalleryPage } from './ConnectorsGalleryPage';
import {
  agent,
  renderAt,
  status,
  stubServer,
  world,
  writes,
  zohoStatus,
} from './connectors.test.helpers';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
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
});

const ZC = '/admin/connectors/zoho-crm';
const page = (path: string) => renderAt(path, <ConnectorDetailPage />);

describe('Zoho CRM: Overview', () => {
  it('shows the organisation, account and site, with Open Zoho CRM and the tabs', async () => {
    stubServer(world({ zoho: zohoStatus('connected') }));
    page(ZC);
    expect(await screen.findByText('Kopi Apong Sdn Bhd')).toBeTruthy();
    expect(screen.getByText('aisyah@kopiapong.my')).toBeTruthy();
    expect(screen.getByText('zoho.com')).toBeTruthy();
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Overview',
      'Settings',
      'Activity',
    ]);
    expect(screen.getByRole('link', { name: /Open Zoho CRM/ }).getAttribute('href')).toBe(
      'https://crm.zoho.com/crm/org123/',
    );
    expect(screen.getByText('Find the customer')).toBeTruthy();
    expect(screen.getByText('Add a lead')).toBeTruthy();
    expect(screen.getByText(/Never the chat itself/)).toBeTruthy();
  });

  it('connects in the chosen data centre: a window opens in the click, then the page polls', async () => {
    const w = world({ zoho: zohoStatus('disconnected') });
    const fetchMock = stubServer(w);
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    page(ZC);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('zoho-region'));
    await user.click(await screen.findByRole('option', { name: 'zoho.com.au (Australia)' }));
    await user.click(screen.getByRole('button', { name: 'Connect Zoho CRM' }));
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    await waitFor(() =>
      expect(tab.location.href).toBe('https://accounts.zoho.com/oauth/v2/auth?x=1'),
    );
    expect(tab.opener).toBeNull();
    expect(await screen.findByText('Kopi Apong Sdn Bhd')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Zoho CRM connected');
    expect(writes(fetchMock)).toEqual(['POST /api/connectors/zoho-crm/connect']);
    const body = fetchMock.mock.calls.find((c) => c[0] === '/api/connectors/zoho-crm/connect')![1]!
      .body as string;
    expect(JSON.parse(body)).toEqual({ region: 'com.au' });
  });

  it('shows a blocked window, a cancelled sign-in and the not configured state', async () => {
    stubServer(
      world({
        zoho: zohoStatus('disconnected'),
        zohoProgress: [
          { status: 'pending', error: null },
          { status: 'failed', error: 'denied' },
        ],
      }),
    );
    vi.spyOn(window, 'open').mockReturnValue(null);
    page(ZC);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Zoho CRM' }));
    const waiting = await screen.findByTestId('zoho-signing-in');
    expect(within(waiting).getByText(/Waiting for Zoho sign-in/)).toBeTruthy();
    expect(
      within(waiting)
        .getByRole('link', { name: /Open the sign-in page/ })
        .getAttribute('href'),
    ).toBe('https://accounts.zoho.com/oauth/v2/auth?x=1');
    expect(
      await screen.findByText('Zoho sign-in was cancelled. Nothing was connected.', undefined, {
        timeout: 4000,
      }),
    ).toBeTruthy();
    cleanup();
    stubServer(world({ zoho: zohoStatus('not_configured') }));
    page(ZC);
    expect(await screen.findByText('Not available in this build')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Zoho CRM' })).toBeNull();
  });

  it('shows expired with Sign in again in the same site, and unavailable', async () => {
    const w = world({ zoho: zohoStatus('expired', { region: 'eu' }) });
    const fetchMock = stubServer(w);
    vi.spyOn(window, 'open').mockReturnValue(null);
    page(ZC);
    const user = userEvent.setup();
    expect(await screen.findByText('Zoho sign-in expired')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await screen.findByTestId('zoho-signing-in');
    const body = fetchMock.mock.calls.find((c) => c[0] === '/api/connectors/zoho-crm/connect')![1]!
      .body as string;
    expect(JSON.parse(body)).toEqual({ region: 'eu' });
    cleanup();
    stubServer(world({ zoho: zohoStatus('unavailable') }));
    page(ZC);
    expect(await screen.findByText('Can’t reach Zoho CRM')).toBeTruthy();
  });

  it('disconnects after confirming', async () => {
    const w = world({ zoho: zohoStatus('connected') });
    const fetchMock = stubServer(w);
    page(ZC);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Records in Zoho CRM stay/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('button', { name: 'Connect Zoho CRM' })).toBeTruthy();
    expect(writes(fetchMock)).toEqual(['POST /api/connectors/zoho-crm/disconnect']);
    expect(toast.success).toHaveBeenCalledWith('Zoho CRM disconnected');
  });
});

describe('Zoho CRM: Settings and Activity', () => {
  it('turns on Add new leads, picks an owner and Lead Source, and saves', async () => {
    const w = world({ zoho: zohoStatus('connected') });
    const fetchMock = stubServer(w);
    page(`${ZC}?tab=settings`);
    const user = userEvent.setup();
    const card = await screen.findByTestId('agent-zoho-crm');
    expect(await within(card).findByText('Rules the AI always follows')).toBeTruthy();
    const add = await within(card).findByRole('switch', { name: 'Add new leads' });
    expect(add.getAttribute('aria-checked')).toBe('false');
    expect(within(card).queryByTestId('zoho-owner')).toBeNull();
    await user.click(add);
    await user.click(within(card).getByTestId('zoho-owner'));
    await user.click(await screen.findByRole('option', { name: 'Daniel Tan' }));
    const source = within(card).getByRole('textbox', { name: 'Lead Source' });
    await user.clear(source);
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Enter a Lead Source.')).toBeTruthy();
    await user.type(source, 'WhatsApp shop');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(w.zohoSettings[1]).toEqual({
        ...DEFAULT_ZOHO_CRM_SETTINGS,
        addLeads: true,
        ownerId: '222',
        leadSource: 'WhatsApp shop',
      }),
    );
    expect(writes(fetchMock)).toEqual(['PUT /api/connectors/zoho-crm/agents/1']);
    expect(toast.success).toHaveBeenCalledWith('Saved');
  });

  it('turning Find the customer off also turns Add new leads off', async () => {
    stubServer(
      world({
        zoho: zohoStatus('connected'),
        zohoSettings: { 1: { ...DEFAULT_ZOHO_CRM_SETTINGS, addLeads: true, ownerId: 'gone' } },
      }),
    );
    page(`${ZC}?tab=settings`);
    const user = userEvent.setup();
    const card = await screen.findByTestId('agent-zoho-crm');
    // an owner who left Zoho stays visible
    expect(await within(card).findByText('gone')).toBeTruthy();
    await user.click(within(card).getByRole('switch', { name: 'Find the customer' }));
    const add = within(card).getByRole('switch', { name: 'Add new leads' });
    expect(add.getAttribute('aria-checked')).toBe('false');
    expect(add.hasAttribute('disabled')).toBe(true);
    expect(within(card).getByText('Turn on Find the customer first.')).toBeTruthy();
  });

  it('asks to connect first, and shows the paused banner', async () => {
    stubServer(world({ zoho: zohoStatus('disconnected') }));
    page(`${ZC}?tab=settings`);
    const user = userEvent.setup();
    expect(await screen.findByText('Connect Zoho CRM first on the Overview tab.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Connect Zoho CRM' }));
    expect(await screen.findByTestId('zoho-crm-account')).toBeTruthy();
    cleanup();
    stubServer(world({ zoho: zohoStatus('expired') }));
    page(`${ZC}?tab=settings`);
    expect(await screen.findByText(/answers without it/)).toBeTruthy();
  });

  it('lists the activity lines, or says there is none yet', async () => {
    stubServer(
      world({
        zoho: zohoStatus('connected'),
        zohoActivity: [
          {
            id: 3,
            at: Date.now(),
            kind: 'not_added',
            agentId: 1,
            actorName: 'Aina',
            chatJid: null,
            customer: 'Siti',
            module: null,
            reason: 'no_name',
          },
          {
            id: 2,
            at: Date.now(),
            kind: 'found',
            agentId: 1,
            actorName: 'Aina',
            chatJid: null,
            customer: 'Farah Aziz',
            module: 'Contacts',
            reason: null,
          },
        ],
      }),
    );
    page(`${ZC}?tab=activity`);
    const list = await screen.findByTestId('zoho-activity');
    expect(within(list).getByText('Aina did not add Siti: no name yet')).toBeTruthy();
    expect(within(list).getByText('Aina found Farah Aziz in Contacts')).toBeTruthy();
    cleanup();
    stubServer(world({ zoho: zohoStatus('connected') }));
    page(`${ZC}?tab=activity`);
    expect(await screen.findByText(/Who and when only/)).toBeTruthy();
  });
});

describe('Zoho CRM in the gallery and on the agent page', () => {
  it('shows Zoho CRM once, with its own state', async () => {
    stubServer(world({ zoho: zohoStatus('unavailable'), google: status('disconnected') }));
    renderAt('/admin/connectors', <ConnectorsGalleryPage />, { route: '/admin/connectors' });
    // Needs attention moves it under "Your connectors"
    await screen.findByRole('heading', { name: 'Your connectors' });
    const card = screen.getByTestId('connector-card-zoho-crm');
    expect(within(card).getByText('Needs attention')).toBeTruthy();
    expect(screen.getAllByTestId('connector-card-zoho-crm')).toHaveLength(1);
  });

  it('adds a Zoho CRM row to the agent page while connected', async () => {
    stubServer(
      world({
        zoho: zohoStatus('connected'),
        google: status('disconnected'),
        zohoSettings: { 1: { ...DEFAULT_ZOHO_CRM_SETTINGS, addLeads: true } },
        agents: [agent(1, 'Aina')],
      }),
    );
    renderAt('/admin/members/ai/1', <AgentConnectorsCard agentId={1} name="Aina" />, {
      route: '/admin/members/ai/:agentId',
    });
    const row = await screen.findByTestId('agent-connector-zoho-crm');
    expect(row.getAttribute('href')).toBe('/admin/connectors/zoho-crm?tab=settings&agent=1');
    expect(await within(row).findByText('Finds customers and adds new leads')).toBeTruthy();
    expect(screen.queryByText('No connector yet.')).toBeNull();
  });
});

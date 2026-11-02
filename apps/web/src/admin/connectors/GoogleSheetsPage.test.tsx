import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { DEFAULT_SHEETS_SETTINGS } from '@ezychat/shared';
import { AgentConnectorsCard } from './AgentConnectorsCard';
import { ConnectorDetailPage } from './ConnectorDetailPage';
import { ConnectorsGalleryPage } from './ConnectorsGalleryPage';
import {
  SHEET_ID,
  agent,
  renderAt,
  sheetsStatus,
  stubServer,
  world,
  writes,
} from './connectors.test.helpers';

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

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
});

const GS = '/admin/connectors/google-sheets';
const LINK = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;
const page = (path: string) => renderAt(path, <ConnectorDetailPage />);
const location = () => screen.getByTestId('location').textContent;
const connected = (patch: Parameters<typeof world>[0] = {}) =>
  world({ sheets: sheetsStatus('connected'), ...patch });

describe('Google Sheets: gallery and Overview', () => {
  it('shows the built-in card in the gallery with its own sign-in state', async () => {
    stubServer(connected());
    renderAt('/admin/connectors', <ConnectorsGalleryPage />, { route: '/admin/connectors' });
    // Connected cards move to "Your connectors": query the card again once the state is in.
    await waitFor(() =>
      expect(
        within(screen.getByTestId('connector-card-google-sheets')).getByText('Connected'),
      ).toBeTruthy(),
    );
    const card = screen.getByTestId('connector-card-google-sheets');
    expect(within(card).getByText('Google Sheets')).toBeTruthy();
    expect(card.querySelector('a')!.getAttribute('href')).toBe(GS);
  });

  it('connects with Google in a new window and shows the account', async () => {
    const fetchMock = stubServer(world());
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    page(GS);
    expect(await screen.findByRole('heading', { name: 'Google Sheets' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Overview',
      'Settings',
      'Activity',
    ]);
    expect(screen.getByText('Read rows')).toBeTruthy();
    expect(screen.getByText('Add leads')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Google Sheets' }));
    await waitFor(() =>
      expect(tab.location.href).toBe('https://accounts.google.com/o/oauth2/v2/auth?s=1'),
    );
    expect(await screen.findByText('Working')).toBeTruthy();
    expect(screen.getByText('kopiapong@gmail.com')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Google Sheets connected');
    expect(writes(fetchMock)).toEqual(['POST /api/connectors/google-sheets/connect']);
  });

  it('warns about an expired sign-in or an unreachable Google, and disconnects', async () => {
    stubServer(world({ sheets: sheetsStatus('expired') }));
    page(GS);
    expect(await screen.findByText('Google sign-in expired')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy();
    cleanup();
    stubServer(world({ sheets: sheetsStatus('unavailable') }));
    page(GS);
    expect(await screen.findByText("Can't reach Google Sheets")).toBeTruthy();
    cleanup();
    const fetchMock = stubServer(connected());
    page(GS);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Rows already in your sheet stay/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('button', { name: 'Connect Google Sheets' })).toBeTruthy();
    expect(writes(fetchMock)).toEqual(['POST /api/connectors/google-sheets/disconnect']);
    cleanup();
    stubServer(world({ sheets: sheetsStatus('not_configured') }));
    page(GS);
    expect(
      await screen.findByText('Google sign-in is not set up in this build of EzyChat Lite.'),
    ).toBeTruthy();
  });
});

describe('Google Sheets: Settings', () => {
  it('asks to connect first', async () => {
    stubServer(world());
    page(`${GS}?tab=settings`);
    expect(
      await screen.findByText('Connect a Google account on the Overview tab first.'),
    ).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Connect Google Sheets' }));
    expect(location()).toBe(`${GS}?tab=overview`);
  });

  it('finds a sheet from its link, picks tabs and saves both switches', async () => {
    const w = connected();
    const fetchMock = stubServer(w);
    page(`${GS}?tab=settings`);
    const user = userEvent.setup();
    const link = await screen.findByTestId('sheets-link');
    // Add leads needs a sheet first.
    expect(screen.getByRole('switch', { name: 'Add leads' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByTestId('sheets-find'));
    expect(screen.getByText('Paste the link of a Google Sheets spreadsheet.')).toBeTruthy();
    await user.type(link, 'https://example.com/nope');
    await user.click(screen.getByTestId('sheets-find'));
    expect(await screen.findByText(/cannot open this spreadsheet/)).toBeTruthy();
    await user.clear(link);
    await user.type(link, `${LINK}{Enter}`);
    const chosen = await screen.findByTestId('sheets-chosen');
    expect(within(chosen).getByText('Kopi Apong prices')).toBeTruthy();
    expect(
      within(chosen)
        .getByRole('link', { name: /Open in Google Sheets/ })
        .getAttribute('href'),
    ).toBe(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
    // The first tab is chosen for look-ups.
    expect(screen.getByTestId('sheets-lookup-tab').textContent).toContain('Menu');

    await user.click(screen.getByRole('switch', { name: 'Add leads' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Choose a tab.')).toBeTruthy();
    await user.click(screen.getByTestId('sheets-leads-tab'));
    await user.click(screen.getByRole('option', { name: 'Leads' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writes(fetchMock)).toContain('PUT /api/connectors/google-sheets/agents/1'),
    );
    expect(w.sheetSettings[1]).toEqual({
      ...DEFAULT_SHEETS_SETTINGS,
      spreadsheetId: SHEET_ID,
      spreadsheetName: 'Kopi Apong prices',
      lookupTab: 'Menu',
      addLeads: true,
      leadsTab: 'Leads',
    });
    expect(toast.success).toHaveBeenCalledWith('Google Sheets settings saved');
  });

  it('loads the saved sheet with its tabs and shows a paused banner while Google fails', async () => {
    const saved = {
      ...DEFAULT_SHEETS_SETTINGS,
      spreadsheetId: SHEET_ID,
      spreadsheetName: 'Kopi Apong prices',
      lookupTab: 'Old tab',
    };
    const fetchMock = stubServer(
      world({
        sheets: sheetsStatus('expired'),
        sheetSettings: { 2: saved },
        agents: [agent(1, 'Aina'), agent(2, 'Ben')],
      }),
    );
    page(`${GS}?tab=settings&agent=2`);
    expect(await screen.findByText('Paused: sign in to Google again')).toBeTruthy();
    expect(screen.getByText('Ben does not use the sheet until it works again.')).toBeTruthy();
    expect(within(screen.getByTestId('sheets-chosen')).getByText('Kopi Apong prices')).toBeTruthy();
    // A tab Google no longer lists stays shown until it is changed.
    await waitFor(() =>
      expect(fetchMock.mock.calls.map((c) => c[0])).toContain(
        '/api/connectors/google-sheets/spreadsheet',
      ),
    );
    expect(screen.getByTestId('sheets-lookup-tab').textContent).toContain('Old tab');
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Read rows' }));
    expect(screen.queryByTestId('sheets-lookup-tab')).toBeNull();
  });
});

describe('Google Sheets: Activity and the agent page', () => {
  it('lists what the AI looked up and added, never the values', async () => {
    stubServer(
      connected({
        sheetsActivity: [
          {
            id: 2,
            at: Date.now(),
            kind: 'lead_added',
            agentId: 1,
            agentName: 'Aina',
            chatJid: 'a',
            customer: 'Mei Ying',
          },
          {
            id: 1,
            at: Date.now(),
            kind: 'looked_up',
            agentId: 1,
            agentName: 'Aina',
            chatJid: 'a',
            customer: 'Mei Ying',
          },
          {
            id: 0,
            at: Date.now(),
            kind: 'failed',
            agentId: 1,
            agentName: 'Aina',
            chatJid: 'a',
            customer: 'Ali',
          },
        ],
      }),
    );
    page(`${GS}?tab=activity`);
    const list = await screen.findByTestId('sheets-activity');
    expect(within(list).getByText('Aina added Mei Ying as a lead')).toBeTruthy();
    expect(within(list).getByText('Aina looked up the sheet for Mei Ying')).toBeTruthy();
    expect(within(list).getByText('Aina could not reach Google Sheets for Ali')).toBeTruthy();
    cleanup();
    stubServer(connected());
    page(`${GS}?tab=activity`);
    expect(await screen.findByText('Nothing yet.')).toBeTruthy();
  });

  it.each([
    [{ lookupTab: 'Menu' }, 'Reads the sheet'],
    [{ lookupTab: 'Menu', addLeads: true, leadsTab: 'Leads' }, 'Reads the sheet and adds leads'],
    [{ lookup: false, addLeads: true, leadsTab: 'Leads' }, 'Adds leads'],
    [{ lookup: false }, 'Off for this agent'],
  ])('sums up the agent’s Google Sheets on the agent page', async (patch, summary) => {
    stubServer(
      connected({
        sheetSettings: { 3: { ...DEFAULT_SHEETS_SETTINGS, spreadsheetId: SHEET_ID, ...patch } },
      }),
    );
    renderAt('/admin/members/ai/3', <AgentConnectorsCard agentId={3} name="Aina" />, {
      route: '/admin/members/ai/:agentId',
    });
    const row = await screen.findByTestId('agent-connector-google-sheets');
    expect(row.getAttribute('href')).toBe(`${GS}?tab=settings&agent=3`);
    expect(await within(row).findByText(summary)).toBeTruthy();
  });
});

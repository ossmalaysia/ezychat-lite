import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { DEFAULT_BOOKING_SETTINGS } from '@ezychat/shared';
import { ConnectorDetailPage } from './ConnectorDetailPage';
import { agent, renderAt, status, stubServer, world, writes } from './connectors.test.helpers';

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

const page = (path: string, opts: Parameters<typeof renderAt>[2] = {}) =>
  renderAt(path, <ConnectorDetailPage />, opts);
const location = () => screen.getByTestId('location').textContent;
const GC = '/admin/connectors/google-calendar';

describe('connector pages', () => {
  it('says an unknown connector does not exist and links back to the gallery', async () => {
    stubServer(world());
    page('/admin/connectors/nope');
    expect(screen.getByText('This connector does not exist.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All connectors' }).getAttribute('href')).toBe(
      '/admin/connectors',
    );
  });

  it('shows a coming-soon connector with its tools and Vote', () => {
    stubServer(world());
    page('/admin/connectors/autocount');
    expect(screen.getByRole('heading', { name: 'AutoCount' })).toBeTruthy();
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0);
    expect(screen.getByText('Create a quotation')).toBeTruthy();
    expect(screen.getByText('Changes data')).toBeTruthy();
    expect(screen.getByText('Look-up')).toBeTruthy();
    expect(
      decodeURIComponent(screen.getByTestId('vote-connector').getAttribute('href')!),
    ).toContain('AutoCount');
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('explains the custom connector needs Enterprise, with the upgrade button', () => {
    stubServer(world());
    page('/admin/connectors/custom-mcp');
    expect(screen.getByText('This connector is part of EzyChat Enterprise.')).toBeTruthy();
    expect(screen.getByTestId('upgrade-enterprise')).toBeTruthy();
    expect(screen.queryByTestId('vote-connector')).toBeNull();
    cleanup();
    page('/admin/connectors/custom-mcp', { links: { upgrade: null } });
    expect(screen.queryByTestId('upgrade-enterprise')).toBeNull();
  });

  it("opens the extension's page for a connector it provides", () => {
    stubServer(world());
    page('/admin/connectors/custom-mcp', {
      extensions: [{ name: 'ent', connectorLinks: { 'custom-mcp': '/admin/ext/ent/c' } }],
    });
    expect(location()).toBe('/admin/ext/ent/c');
  });
});

describe('Google Calendar: Overview', () => {
  it('shows the connected account, its calendars and the tabs', async () => {
    stubServer(world());
    page(GC);
    expect(await screen.findByText('Working')).toBeTruthy();
    expect(screen.getAllByText('kopiapong@gmail.com')).toHaveLength(2);
    expect(screen.getByText('Holidays in Malaysia')).toBeTruthy();
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Overview',
      'Settings',
      'Activity',
    ]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(location()).toBe(`${GC}?tab=settings`);
  });

  it('says when this build has no Google sign-in', async () => {
    stubServer(world({ google: status('not_configured') }));
    page(GC);
    expect(
      await screen.findByText('Google sign-in is not set up in this build of EzyChat Lite.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Google Calendar' })).toBeNull();
  });

  it('warns about an expired sign-in and an unreachable Google', async () => {
    stubServer(world({ google: status('expired') }));
    page(GC);
    expect(await screen.findByText('Google sign-in expired')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy();
    expect(screen.getByText('Calendars in this account')).toBeTruthy();
    cleanup();
    // Expired with no calendar list: no misleading "No calendars found".
    stubServer(world({ google: status('expired', { calendars: [] }) }));
    page(GC);
    expect(await screen.findByText('Google sign-in expired')).toBeTruthy();
    expect(screen.queryByText('Calendars in this account')).toBeNull();
    expect(screen.queryByText('No calendars found.')).toBeNull();
    cleanup();
    stubServer(world({ google: status('unavailable') }));
    page(GC);
    expect(await screen.findByText("Can't reach Google Calendar")).toBeTruthy();
  });

  it('connects: opens a window in the click, points it at Google and polls until done', async () => {
    const w = world({ google: status('disconnected') });
    const fetchMock = stubServer(w);
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    page(GC);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Google Calendar' }));
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    await waitFor(() =>
      expect(tab.location.href).toBe('https://accounts.google.com/o/oauth2/v2/auth?x=1'),
    );
    expect(tab.opener).toBeNull();
    expect(await screen.findByText('Working')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Google Calendar connected');
    expect(writes(fetchMock)).toEqual(['POST /api/connectors/google-calendar/connect']);
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(
      '/api/connectors/google-calendar/connect/req-1',
    );
  });

  it('offers the sign-in link when the browser blocked the window, and can cancel', async () => {
    stubServer(
      world({ google: status('disconnected'), progress: [{ status: 'pending', error: null }] }),
    );
    vi.spyOn(window, 'open').mockReturnValue(null);
    page(GC);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Google Calendar' }));
    const waiting = await screen.findByTestId('google-signing-in');
    expect(within(waiting).getByText(/blocked the sign-in window/)).toBeTruthy();
    expect(
      within(waiting)
        .getByRole('link', { name: /Open the sign-in page/ })
        .getAttribute('href'),
    ).toBe('https://accounts.google.com/o/oauth2/v2/auth?x=1');
    expect(within(waiting).getByText(/only finishes in a browser on that computer/)).toBeTruthy();
    await user.click(within(waiting).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('google-signing-in')).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect Google Calendar' })).toBeTruthy();
  });

  it('says the person cancelled at Google', async () => {
    stubServer(
      world({ google: status('disconnected'), progress: [{ status: 'failed', error: 'denied' }] }),
    );
    const tab = { opener: null, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    page(GC);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Google Calendar' }));
    expect(
      await screen.findByText('Google sign-in was cancelled. Nothing was connected.'),
    ).toBeTruthy();
  });

  it('closes the window and shows the error when starting the sign-in fails', async () => {
    stubServer(
      world({
        google: status('disconnected'),
        fail: { 'POST /connectors/google-calendar/connect': 500 },
      }),
    );
    const tab = { opener: null, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    page(GC);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Google Calendar' }));
    expect(await screen.findByText('Boom')).toBeTruthy();
    expect(tab.close).toHaveBeenCalled();
  });

  it('disconnects after a confirmation', async () => {
    const fetchMock = stubServer(world());
    page(GC);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Events already in your calendar stay/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('button', { name: 'Connect Google Calendar' })).toBeTruthy();
    expect(writes(fetchMock)).toEqual(['POST /api/connectors/google-calendar/disconnect']);
  });

  it('shows a load error with Retry', async () => {
    stubServer(world({ fail: { 'GET /connectors/google-calendar': 500 } }));
    page(GC);
    expect(await screen.findByText('Boom')).toBeTruthy();
  });
});

describe('Google Calendar: Settings', () => {
  it('saves the booking settings of the agent', async () => {
    const w = world();
    const fetchMock = stubServer(w);
    page(`${GC}?tab=settings`);
    const user = userEvent.setup();
    expect(
      await screen.findByText(
        'Aina can check free times and book appointments in Google Calendar.',
      ),
    ).toBeTruthy();
    // No agent picker with one agent; Save waits for a change.
    expect(screen.queryByText('Settings for')).toBeNull();
    const save = screen.getByRole('button', { name: 'Save bookings' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // Booking needs a calendar; read-only calendars are not offered.
    await user.click(screen.getByRole('switch', { name: 'Book appointments' }));
    await user.click(save);
    expect(screen.getByText('Choose the calendar for bookings.')).toBeTruthy();
    await user.click(screen.getByTestId('booking-calendar'));
    expect(screen.queryByRole('option', { name: 'Holidays in Malaysia' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'Table bookings' }));
    const title = screen.getByLabelText('Event title');
    await user.clear(title);
    await user.type(title, 'Table booking');
    await user.click(screen.getByLabelText('Sun'));
    await user.click(save);
    await waitFor(() =>
      expect(writes(fetchMock)).toEqual(['PUT /api/connectors/google-calendar/agents/1']),
    );
    expect(w.bookings[1]).toEqual({
      ...DEFAULT_BOOKING_SETTINGS,
      calendarId: 'bookings',
      book: true,
      title: 'Table booking',
      days: [0, 1, 2, 3, 4, 5, 6],
    });
    await waitFor(() => expect(save.disabled).toBe(true));
  });

  it('checks the title, the hours and the days before saving', async () => {
    const fetchMock = stubServer(
      world({ bookings: { 1: { ...DEFAULT_BOOKING_SETTINGS, calendarId: 'primary' } } }),
    );
    page(`${GC}?tab=settings`);
    const user = userEvent.setup();
    const title = await screen.findByLabelText('Event title');
    await user.clear(title);
    const to = screen.getByLabelText('To');
    await user.clear(to);
    await user.type(to, '09:00');
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
      await user.click(screen.getByLabelText(day));
    await user.click(screen.getByRole('button', { name: 'Save bookings' }));
    expect(screen.getByText('Enter an event title.')).toBeTruthy();
    expect(screen.getByText('The end must be after the start.')).toBeTruthy();
    expect(screen.getByText('Choose at least one day.')).toBeTruthy();
    expect(writes(fetchMock)).toEqual([]);
  });

  it('turns booking off with free times and explains why', async () => {
    stubServer(
      world({
        bookings: { 1: { ...DEFAULT_BOOKING_SETTINGS, book: true, calendarId: 'primary' } },
      }),
    );
    page(`${GC}?tab=settings`);
    const user = userEvent.setup();
    const book = (await screen.findByRole('switch', {
      name: 'Book appointments',
    })) as HTMLButtonElement;
    expect(book.getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('switch', { name: 'Check free times' }));
    expect(book.getAttribute('aria-checked')).toBe('false');
    expect(book.disabled).toBe(true);
    expect(screen.getByText('Turn on Check free times first.')).toBeTruthy();
  });

  it('picks the agent from the address and the picker with several agents', async () => {
    stubServer(world({ agents: [agent(1, 'Aina'), agent(2, 'Ben')] }));
    page(`${GC}?tab=settings&agent=2`);
    const user = userEvent.setup();
    expect(await screen.findByText(/^Ben can check free times/)).toBeTruthy();
    await user.click(screen.getByLabelText('Settings for'));
    await user.click(screen.getByRole('option', { name: 'Aina' }));
    expect(await screen.findByText(/^Aina can check free times/)).toBeTruthy();
    expect(location()).toBe(`${GC}?tab=settings&agent=1`);
  });

  it('asks to connect first, and pauses while Google needs attention', async () => {
    stubServer(world({ google: status('disconnected') }));
    page(`${GC}?tab=settings`);
    const user = userEvent.setup();
    expect(await screen.findByText(/Connect Google Calendar first/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Connect Google Calendar' }));
    expect(location()).toBe(`${GC}?tab=overview`);
    cleanup();
    stubServer(world({ google: status('expired') }));
    page(`${GC}?tab=settings`);
    expect(await screen.findByText('Paused: Google sign-in expired')).toBeTruthy();
    cleanup();
    stubServer(world({ google: status('not_configured') }));
    page(`${GC}?tab=settings`);
    expect(await screen.findByText(/not set up in this build/)).toBeTruthy();
  });

  it('asks for an AI agent when there is none', async () => {
    stubServer(world({ agents: [] }));
    page(`${GC}?tab=settings`);
    expect(await screen.findByText('Add an AI agent first.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add an AI agent' }).getAttribute('href')).toBe(
      '/admin/members/ai/new',
    );
  });
});

describe('Google Calendar: Activity', () => {
  it('lists what the AI checked, booked and handed over', async () => {
    const start = new Date(2026, 9, 30, 19, 30).toISOString();
    const end = new Date(2026, 9, 30, 21, 0).toISOString();
    const row = {
      agentId: 1,
      agentName: 'Aina',
      chatJid: null,
      customer: 'Mei Ying',
      start: null,
      end: null,
    };
    stubServer(
      world({
        activity: [
          { ...row, id: 4, at: Date.now(), kind: 'booked', start, end },
          { ...row, id: 3, at: Date.now(), kind: 'booked' },
          { ...row, id: 2, at: Date.now(), kind: 'checked' },
          { ...row, id: 1, at: Date.now(), kind: 'handed_over' },
          { ...row, id: 0, at: Date.now(), kind: 'failed' },
        ],
      }),
    );
    page(`${GC}?tab=activity`);
    const list = await screen.findByTestId('calendar-activity');
    const lines = [...list.querySelectorAll('li')].map(
      (li) => li.firstElementChild?.nextElementSibling?.firstElementChild?.textContent,
    );
    expect(lines[0]).toMatch(/^Aina booked Fri,? 30 Oct, 19:30–21:00 for Mei Ying$/);
    expect(lines.slice(1)).toEqual([
      'Aina booked a time for Mei Ying',
      'Aina checked free times for Mei Ying',
      "Aina handed Mei Ying's booking to the team",
      'Aina could not reach Google Calendar for Mei Ying',
    ]);
  });

  it('says when there is nothing yet', async () => {
    stubServer(world());
    page(`${GC}?tab=activity`);
    expect(await screen.findByText('Nothing yet.')).toBeTruthy();
  });
});

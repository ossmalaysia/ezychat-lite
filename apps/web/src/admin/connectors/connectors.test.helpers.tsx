import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  DEFAULT_BOOKING_SETTINGS,
  type AiAgentSummary,
  type BookingSettings,
  type CalendarActivity,
  type GoogleCalendarConnectProgress,
  type GoogleCalendarStatus,
} from '@ezychat/shared';
import { AppLinksProvider } from '@/lib/app-links';
import { resolveAppLinks, type AppLinks } from '@/lib/links';
import { WebExtensionsProvider, type WebExtension } from '../../extensions';

export const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });

export const CALENDARS: GoogleCalendarStatus['calendars'] = [
  { id: 'primary', name: 'kopiapong@gmail.com', primary: true, readOnly: false },
  { id: 'bookings', name: 'Table bookings', primary: false, readOnly: false },
  { id: 'holidays', name: 'Holidays in Malaysia', primary: false, readOnly: true },
];

export const status = (
  state: GoogleCalendarStatus['state'],
  patch: Partial<GoogleCalendarStatus> = {},
): GoogleCalendarStatus => ({
  state,
  account:
    state === 'connected' || state === 'expired' || state === 'unavailable'
      ? 'kopiapong@gmail.com'
      : null,
  calendars: state === 'disconnected' || state === 'not_configured' ? [] : CALENDARS,
  connectedAt: null,
  problemSince: null,
  ...patch,
});

export const agent = (id: number, displayName: string): AiAgentSummary => ({
  id,
  userId: 100 + id,
  displayName,
  enabled: true,
  preset: 'sales',
  inboxId: id,
  documentCount: 0,
});

/** The server as the connector pages see it; every write is recorded. */
export interface World {
  google: GoogleCalendarStatus;
  agents: AiAgentSummary[];
  bookings: Record<number, BookingSettings>;
  activity: CalendarActivity[];
  /** Answers to the sign-in polls, in order (the last one repeats). */
  progress: GoogleCalendarConnectProgress[];
  /** Fail a path with this status (e.g. 500). */
  fail?: Partial<Record<string, number>>;
}

export function world(patch: Partial<World> = {}): World {
  return {
    google: status('connected'),
    agents: [agent(1, 'Aina')],
    bookings: {},
    activity: [],
    progress: [{ status: 'done', error: null }],
    ...patch,
  };
}

export function stubServer(w: World) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.replace(/^\/api/, '');
    const failCode = w.fail?.[`${method} ${path}`];
    if (failCode) return json({ error: { code: 'internal', message: 'Boom' } }, failCode);
    if (path === '/connectors/google-calendar') return json(w.google);
    if (path === '/connectors/google-calendar/connect' && method === 'POST')
      return json({
        requestId: 'req-1',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
      });
    if (path.startsWith('/connectors/google-calendar/connect/')) {
      const next = w.progress.length > 1 ? w.progress.shift()! : w.progress[0]!;
      if (next.status === 'done') w.google = status('connected');
      return json(next);
    }
    if (path === '/connectors/google-calendar/disconnect' && method === 'POST') {
      w.google = status('disconnected');
      return json({ ok: true });
    }
    const agentMatch = /^\/connectors\/google-calendar\/agents\/(\d+)$/.exec(path);
    if (agentMatch) {
      const id = Number(agentMatch[1]);
      if (method === 'PUT') w.bookings[id] = JSON.parse(String(init!.body)) as BookingSettings;
      return json(w.bookings[id] ?? DEFAULT_BOOKING_SETTINGS);
    }
    if (path === '/connectors/google-calendar/activity') return json({ activity: w.activity });
    if (path === '/ai/agents') return json({ agents: w.agents, maxAgents: 5 });
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const writes = (fetchMock: ReturnType<typeof stubServer>) =>
  fetchMock.mock.calls
    .filter((c) => c[1]?.method && c[1].method !== 'GET')
    .map((c) => `${c[1]!.method} ${c[0]}`);

function Location() {
  const l = useLocation();
  return <output data-testid="location">{`${l.pathname}${l.search}`}</output>;
}

export function renderAt(
  path: string,
  element: ReactNode,
  {
    route = '/admin/connectors/:id',
    extensions = [],
    links = {},
  }: { route?: string; extensions?: WebExtension[]; links?: Partial<AppLinks> } = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AppLinksProvider links={resolveAppLinks(links)}>
        <WebExtensionsProvider extensions={extensions}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path={route} element={element} />
              <Route path="*" element={<p>elsewhere</p>} />
            </Routes>
            <Location />
          </MemoryRouter>
        </WebExtensionsProvider>
      </AppLinksProvider>
    </QueryClientProvider>,
  );
}

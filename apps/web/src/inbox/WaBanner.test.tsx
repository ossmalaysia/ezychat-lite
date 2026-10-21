import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Inbox, User, WaStatus } from '@ezychat/shared';
import { WaBanner } from './WaBanner';

const admin: User = {
  id: 1,
  username: 'aisyah',
  displayName: 'Aisyah',
  role: 'admin',
  mustChangePassword: false,
  disabled: false,
  createdAt: 0,
  locale: null,
};

function status(state: WaStatus['state']): WaStatus {
  return { state, me: null, qr: null, lastError: null };
}

function inbox(id: number, name: string, state: WaStatus['state'], removed = false): Inbox {
  return { id, name, tone: 'primary', number: null, removed, status: status(state) };
}

function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(wa: WaStatus['state'], inboxes: Inbox[] | null | 'error', me: User = admin) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/me') return json(me);
    if (url === '/api/wa/status') return json(status(wa));
    if (url === '/api/inboxes' && inboxes === 'error') return json({ error: { code: 'x' } }, 500);
    if (url === '/api/inboxes' && inboxes) return json({ inboxes, maxInboxes: 3, canAdd: true });
    return json({ error: { code: 'not_found', message: 'nope' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WaBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const fetched = (path: string) => fetchMock.mock.calls.some(([url]) => url === path);
  return Object.assign(view, { fetched });
}

const agent: User = { ...admin, id: 2, role: 'agent' };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WaBanner', () => {
  it('keeps the one-inbox banner text and the WhatsApp settings link (Lite)', async () => {
    setup('disconnected', [inbox(1, 'Kopi Apong', 'disconnected')]);
    expect(await screen.findByText('WhatsApp is disconnected')).toBeTruthy();
    const link = await screen.findByRole('link', { name: 'Open WhatsApp settings' });
    expect(link.getAttribute('href')).toBe('/admin/whatsapp');
    expect(screen.queryByText(/Kopi Apong/)).toBeNull();
  });

  it('shows the one-inbox banner on a server without inboxes', async () => {
    setup('qr', null);
    expect(await screen.findByText('WhatsApp is not linked')).toBeTruthy();
  });

  it('falls back to the WhatsApp status when the inbox list fails', async () => {
    setup('logged_out', 'error');
    expect(await screen.findByText('WhatsApp was logged out')).toBeTruthy();
  });

  it('shows nothing while every inbox is open', async () => {
    const view = setup('open', [inbox(1, 'Kopi Apong', 'open'), inbox(2, 'Catering', 'open')]);
    await new Promise((r) => setTimeout(r, 20));
    expect(view.container.textContent).toBe('');
  });

  it('names only the offline inbox when two inboxes are visible', async () => {
    setup('open', [
      inbox(1, 'Kopi Apong', 'open'),
      inbox(2, 'Catering', 'disconnected'),
      inbox(3, 'Closed shop', 'logged_out', true),
    ]);
    const banner = (await screen.findByText('Catering is offline')).closest('[role]')!;
    expect(screen.queryByText(/Kopi Apong/)).toBeNull();
    expect(screen.queryByText(/Closed shop/)).toBeNull();
    expect(screen.queryByText('WhatsApp is disconnected')).toBeNull();
    const link = await within(banner as HTMLElement).findByRole('link', {
      name: 'Open WhatsApp settings',
    });
    expect(link.getAttribute('href')).toBe('/admin/inboxes');
  });

  it('follows the WhatsApp status for inbox 1 and gives one banner per inbox down', async () => {
    setup('logged_out', [inbox(1, 'Kopi Apong', 'open'), inbox(2, 'Catering', 'qr')]);
    expect(await screen.findByText('Kopi Apong was logged out')).toBeTruthy();
    expect(screen.getByText('Catering is not linked')).toBeTruthy();
  });

  it('gives agents no settings link', async () => {
    setup('open', [inbox(1, 'Kopi Apong', 'open'), inbox(2, 'Catering', 'disconnected')], {
      ...admin,
      id: 2,
      role: 'agent',
    });
    expect(await screen.findByText('Catering is offline')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the one visible inbox’s own state, not inbox 1’s, when it is not inbox 1', async () => {
    const view = setup('disconnected', [inbox(2, 'Catering', 'logged_out')]);
    const banner = (await screen.findByText('Catering was logged out')).closest('[role]')!;
    expect(screen.queryByText('WhatsApp is disconnected')).toBeNull();
    const link = await within(banner as HTMLElement).findByRole('link', {
      name: 'Open WhatsApp settings',
    });
    expect(link.getAttribute('href')).toBe('/admin/inboxes');
    expect(view.fetched('/api/wa/status')).toBe(false);
  });

  it('shows no banner for one open inbox other than inbox 1 while inbox 1 is down', async () => {
    const view = setup('disconnected', [inbox(2, 'Catering', 'open')], agent);
    await new Promise((r) => setTimeout(r, 20));
    expect(view.container.textContent).toBe('');
  });

  it('shows no banner to a user with no inbox of a multi-inbox install', async () => {
    const view = setup('logged_out', [], agent);
    await new Promise((r) => setTimeout(r, 20));
    expect(view.container.textContent).toBe('');
    expect(view.fetched('/api/wa/status')).toBe(false);
  });
});

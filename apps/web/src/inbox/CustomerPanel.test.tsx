import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CustomerProfileResponse } from '@wa-team-inbox/shared';
import { CustomerPanel } from './CustomerPanel';
import { buildDirectory } from './useDirectory';

const JID = '601@s.whatsapp.net';
const PROFILE_URL = '/api/chats/601%40s.whatsapp.net/profile';

const directory = buildDirectory(null, false, [
  { id: 1, displayName: 'Mei Ling', role: 'agent', disabled: false },
]);

const EMPTY: CustomerProfileResponse = {
  profile: {
    name: null,
    company: null,
    email: null,
    otherPhone: null,
    address: null,
    tags: [],
    updatedAt: null,
    updatedBy: null,
  },
  whatsappName: 'Farah 🌸',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockApi(initial: CustomerProfileResponse) {
  let current = initial;
  const put = vi.fn((body: Record<string, unknown>) => {
    current = {
      profile: {
        name: (body.name as string) || null,
        company: (body.company as string) || null,
        email: (body.email as string) || null,
        otherPhone: (body.otherPhone as string) || null,
        address: (body.address as string) || null,
        tags: body.tags as string[],
        updatedAt: Date.now(),
        updatedBy: 1,
      },
      whatsappName: current.whatsappName,
    };
    return current;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === PROFILE_URL && method === 'GET') return json(current);
      if (url === PROFILE_URL && method === 'PUT')
        return json(put(JSON.parse(String(init!.body)) as Record<string, unknown>));
      if (url.startsWith('/api/customer-tags')) return json({ tags: ['VIP', 'Wholesale'] });
      return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    }),
  );
  return put;
}

function renderPanel(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const guardRef: { current: ((next: () => void) => void) | null } = { current: null };
  render(
    <QueryClientProvider client={qc}>
      <CustomerPanel jid={JID} open directory={directory} onClose={onClose} guardRef={guardRef} />
    </QueryClientProvider>,
  );
  return { qc, onClose, guardRef };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CustomerPanel', () => {
  it('shows an empty state, then validates and saves edited details', async () => {
    const put = mockApi(EMPTY);
    renderPanel();
    expect(await screen.findByText('No details yet')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add details' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Farah Aziz');
    await userEvent.type(screen.getByLabelText('Email'), 'nope');
    await userEvent.type(screen.getByRole('combobox'), 'VIP{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(put.mock.calls[0]![0]).toEqual({
      name: 'Farah Aziz',
      company: '',
      email: '',
      otherPhone: '',
      address: '',
      tags: ['VIP'],
    });
    expect(await screen.findByText('Farah Aziz')).toBeTruthy();
    expect(screen.getByText('WhatsApp: Farah 🌸')).toBeTruthy();
    expect(screen.getByText('VIP')).toBeTruthy();
    expect(screen.getByText(/^Updated by Mei Ling · /)).toBeTruthy();
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('shows saved fields as links and hides empty ones', async () => {
    mockApi({
      profile: {
        name: 'Farah Aziz',
        company: 'Farah Catering Co',
        email: 'orders@farah.my',
        otherPhone: '+60 12-345 6789',
        address: null,
        tags: ['VIP', 'Halal'],
        updatedAt: Date.now(),
        updatedBy: 1,
      },
      whatsappName: 'Farah Aziz',
    });
    renderPanel();
    expect(await screen.findByText('Farah Catering Co')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'orders@farah.my' }).getAttribute('href')).toBe(
      'mailto:orders@farah.my',
    );
    expect(screen.getByRole('link', { name: '+60 12-345 6789' }).getAttribute('href')).toBe(
      'tel:+60123456789',
    );
    // The WhatsApp name equals the profile name, so it is not repeated.
    expect(screen.queryByText('WhatsApp: Farah Aziz')).toBeNull();
    expect(screen.queryByText('Address / area')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('Esc cancels an unchanged edit and asks before discarding changes', async () => {
    const put = mockApi(EMPTY);
    const { onClose } = renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Add details' }));
    await userEvent.click(screen.getByLabelText('Name'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Add details' }));
    await userEvent.type(screen.getByLabelText('Company'), 'Farah Co');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Company') as HTMLInputElement).value).toBe('Farah Co');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(screen.queryByLabelText('Company')).toBeNull();
    expect(screen.getByText('No details yet')).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter saves', async () => {
    const put = mockApi(EMPTY);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Add details' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Farah{Control>}{Enter}{/Control}');
    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(await screen.findByText('Farah')).toBeTruthy();
  });

  it('saves a tag that was typed but not yet added', async () => {
    const put = mockApi(EMPTY);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Add details' }));
    await userEvent.type(screen.getByRole('combobox'), 'Wholesale');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(put.mock.calls[0]![0]).toMatchObject({ tags: ['Wholesale'] });
  });

  it('asks before the close button discards unsaved changes', async () => {
    mockApi(EMPTY);
    const { onClose } = renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Add details' }));
    await userEvent.type(screen.getByLabelText('Company'), 'Farah Co');
    await userEvent.click(screen.getByRole('button', { name: 'Close customer details' }));
    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Company') as HTMLInputElement).value).toBe('Farah Co');
    await userEvent.click(screen.getByRole('button', { name: 'Close customer details' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('lets the header guard ask before leaving unsaved changes', async () => {
    mockApi(EMPTY);
    const { guardRef } = renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Add details' }));
    const next = vi.fn();
    // Not dirty yet: the guard runs the action straight away.
    act(() => guardRef.current!(next));
    expect(next).toHaveBeenCalledOnce();
    await userEvent.type(screen.getByLabelText('Company'), 'Farah Co');
    act(() => guardRef.current!(next));
    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
    expect(next).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(next).toHaveBeenCalledTimes(2);
  });
});

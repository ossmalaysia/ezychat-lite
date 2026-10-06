import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { CustomerProfileResponse } from '@wa-team-inbox/shared';
import { CustomerDetails, CustomerPanel } from './CustomerPanel';
import { buildDirectory } from './useDirectory';

const JID = '601@s.whatsapp.net';
const PROFILE_URL = '/api/chats/601%40s.whatsapp.net/profile';

const directory = buildDirectory(null, false, [
  { id: 1, displayName: 'Mei Ling', role: 'agent', disabled: false },
]);

const EMPTY: CustomerProfileResponse = {
  profile: {
    id: null,
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
        id: current.profile.id ?? 'p1',
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
  return Object.assign(put, {
    /** A teammate's save: the next GET returns this. */
    setServer(next: CustomerProfileResponse) {
      current = next;
    },
  });
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
        id: 'p1',
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

  it('clears the header guard when a discarded form closes with the panel', async () => {
    mockApi(EMPTY);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const guardRef: { current: ((next: () => void) => void) | null } = { current: null };
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <CustomerPanel
          jid={JID}
          open={open}
          directory={directory}
          onClose={() => setOpen(false)}
          guardRef={guardRef}
        />
      );
    }
    render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Add details' }));
    await userEvent.type(screen.getByLabelText('Company'), 'Farah Co');
    expect(guardRef.current).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close customer details' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByLabelText('Company')).toBeNull());
    expect(guardRef.current).toBeNull();
  });

  it('keeps fields a teammate changed while this form was open', async () => {
    const api = mockApi({
      profile: {
        id: 'p1',
        name: 'Farah',
        company: 'Old Co',
        email: null,
        otherPhone: null,
        address: null,
        tags: ['VIP'],
        updatedAt: 1000,
        updatedBy: 1,
      },
      whatsappName: 'Farah',
    });
    const { qc } = renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.queryByText(/while you were editing/)).toBeNull();
    api.setServer({
      profile: {
        id: 'p1',
        name: 'Farah Aziz',
        company: 'Old Co',
        email: null,
        otherPhone: null,
        address: null,
        tags: ['VIP', 'Halal'],
        updatedAt: 2000,
        updatedBy: 1,
      },
      whatsappName: 'Farah',
    });
    await act(() => qc.invalidateQueries({ queryKey: ['customer-profile', JID] }));
    expect(
      await screen.findByText(
        'Updated by Mei Ling while you were editing — your changes are kept, theirs too',
      ),
    ).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Company'));
    await userEvent.type(screen.getByLabelText('Company'), 'New Co');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(api.mock.calls[0]![0]).toEqual({
      name: 'Farah Aziz',
      company: 'New Co',
      email: '',
      otherPhone: '',
      address: '',
      tags: ['VIP', 'Halal'],
    });
  });

  it('does not add a leftover typed tag beyond the limit', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `t${i}`);
    const put = mockApi({ ...EMPTY, profile: { ...EMPTY.profile, tags: nine } });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'x,y' } });
    expect(input.value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(put.mock.calls[0]![0]).toMatchObject({ tags: [...nine, 'x'] });
  });
});

describe('CustomerDetails', () => {
  const base = EMPTY.profile;

  it('says "Updated <when>" when the teammate is unknown', () => {
    render(
      <CustomerDetails
        profile={{ ...base, name: 'Farah', updatedAt: Date.now(), updatedBy: null }}
        whatsappName={null}
        directory={directory}
      />,
    );
    const line = screen.getByText(/^Updated/);
    expect(line.textContent).not.toMatch(/Updated by/);
    expect(line.textContent).not.toContain('·');
  });

  it('builds a mailto link that cannot carry extra headers', () => {
    render(
      <CustomerDetails
        profile={{ ...base, email: 'a+b@farah.my' }}
        whatsappName={null}
        directory={directory}
      />,
    );
    expect(screen.getByRole('link', { name: 'a+b@farah.my' }).getAttribute('href')).toBe(
      'mailto:a%2Bb@farah.my',
    );
  });

  it('shows a stored email with query characters as plain text', () => {
    const email = 'sales@farah.my?cc=boss@evil.example&body=hi';
    render(<CustomerDetails profile={{ ...base, email }} whatsappName={null} />);
    expect(screen.getByText(email)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

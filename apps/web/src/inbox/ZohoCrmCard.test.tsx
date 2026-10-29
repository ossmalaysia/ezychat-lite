import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ZohoCrmChatRecord } from '@ezychat/shared';
import { ZohoCrmCard } from './ZohoCrmCard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const JID = '601@s.whatsapp.net';
const URL_RECORD = '/api/chats/601%40s.whatsapp.net/zoho-crm';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function serve(record: ZohoCrmChatRecord, add?: () => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === URL_RECORD) return json(record);
    if (url === `${URL_RECORD}/lead` && init?.method === 'POST' && add) return add();
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ZohoCrmCard jid={JID} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const LEAD = {
  module: 'Leads' as const,
  id: '77',
  name: 'Dr. Kavitha Menon',
  company: 'Bright Dental Clinic',
  owner: 'Aisyah Rahman',
  status: 'Not Contacted',
  addedBy: 'ai' as const,
  request: 'Office lunch catering, about 80 pax, 15 Nov.',
  url: 'https://crm.zoho.com/crm/org1/tab/Leads/77',
};

describe('ZohoCrmCard', () => {
  it('shows the lead the AI added with Open in Zoho CRM', async () => {
    serve({ state: 'connected', record: LEAD });
    renderCard();
    expect(await screen.findByText('Dr. Kavitha Menon')).toBeTruthy();
    expect(screen.getByText('Lead')).toBeTruthy();
    expect(screen.getByText('Owner: Aisyah Rahman')).toBeTruthy();
    expect(screen.getByText('Lead status: Not Contacted')).toBeTruthy();
    expect(screen.getByText('Request: Office lunch catering, about 80 pax, 15 Nov.')).toBeTruthy();
    expect(screen.getByText('Added by the AI')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open in Zoho CRM/ }).getAttribute('href')).toBe(
      LEAD.url,
    );
  });

  it('shows a contact without the optional lines', async () => {
    serve({
      state: 'connected',
      record: {
        ...LEAD,
        module: 'Contacts',
        company: null,
        owner: null,
        status: null,
        request: null,
        addedBy: null,
        url: null,
      },
    });
    renderCard();
    expect(await screen.findByText('Contact')).toBeTruthy();
    expect(screen.queryByText(/Owner:/)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('adds a number that is not in Zoho CRM as a lead, and shows errors', async () => {
    const fetchMock = serve({ state: 'connected', record: null }, () =>
      json({ state: 'connected', record: { ...LEAD, addedBy: 'team', request: null } }),
    );
    renderCard();
    const user = userEvent.setup();
    expect(await screen.findByText('Not in Zoho CRM yet.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add as a lead' }));
    expect(await screen.findByText('Added from EzyChat Lite')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Added to Zoho CRM as a lead');
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true);
    cleanup();
    serve({ state: 'connected', record: null }, () =>
      json({ error: { code: 'no_name', message: 'Save the customer’s name first' } }, 409),
    );
    renderCard();
    await user.click(await screen.findByRole('button', { name: 'Add as a lead' }));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('says Zoho CRM is unavailable, and hides itself when not connected', async () => {
    serve({ state: 'unavailable', record: null });
    renderCard();
    expect(await screen.findByText('Zoho CRM is not available right now.')).toBeTruthy();
    cleanup();
    const fetchMock = serve({ state: 'disconnected', record: null });
    const { container } = renderCard();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).toBe('');
  });
});

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AiDocument, AiMemberStatus } from '@wa-team-inbox/shared';
import { useAiMember } from '../api/ai';
import { AiContextPanel } from './AiContextPanel';

const DAY = 24 * 60 * 60 * 1000;
function documents(): AiDocument[] {
  const now = Date.now();
  return [
    {
      id: 1,
      name: 'menu.pdf',
      kind: 'file',
      size: 2 * 1024 * 1024,
      characters: 30_000,
      createdAt: now - 2 * DAY,
      updatedAt: now - 2 * DAY,
    },
    {
      id: 2,
      name: 'Price list',
      kind: 'text',
      size: 900,
      characters: 900,
      createdAt: now - DAY / 2,
      updatedAt: now - DAY / 2,
    },
  ];
}
function status(docs = documents()): AiMemberStatus {
  return {
    member: {
      id: 3,
      username: 'ai-assistant',
      displayName: 'Sales Assistant',
      role: 'agent',
      kind: 'ai',
      mustChangePassword: false,
      disabled: true,
      createdAt: 1,
      locale: null,
    },
    settings: {
      displayName: 'Sales Assistant',
      enabled: false,
      mode: 'api',
      model: '',
      instructions: '',
    },
    hasApiKey: true,
    connection: { state: 'connected', loginUrl: null, error: null },
    documents: docs,
  };
}
function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });
}
const TEXTS: Record<number, string> = { 1: 'Nasi lemak RM8', 2: 'Cake RM50' };

function Harness({ ensureMember }: { ensureMember: () => Promise<boolean> }) {
  const query = useAiMember();
  return query.data ? (
    <AiContextPanel documents={query.data.documents} ensureMember={ensureMember} />
  ) : null;
}
function setup(
  initial = status(),
  ensureMember = vi.fn(async () => true),
  deleteOverride?: (id: number, drop: () => void) => Response | undefined,
) {
  let current = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const id = Number(/\/api\/ai\/documents\/(\d+)$/.exec(url)?.[1]);
    if (url === '/api/ai') return json(current);
    if (url === '/api/ai/documents/text' && method === 'POST') {
      const body = JSON.parse(String(init!.body)) as { name: string; text: string };
      current = {
        ...current,
        documents: [
          ...current.documents,
          {
            id: 9,
            name: body.name,
            kind: 'text',
            size: body.text.length,
            characters: body.text.length,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      };
      return json(current);
    }
    if (url === '/api/ai/documents' && method === 'POST') {
      const file = (init!.body as FormData).get('file') as File;
      current = {
        ...current,
        documents: [
          ...current.documents,
          {
            id: 10,
            name: file.name,
            kind: 'file',
            size: file.size,
            characters: file.size,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      };
      return json(current);
    }
    if (id && method === 'GET') {
      const doc = current.documents.find((d) => d.id === id)!;
      return json({ ...doc, text: TEXTS[id] ?? '', truncated: doc.kind === 'file' });
    }
    if (id && method === 'PATCH') {
      const body = JSON.parse(String(init!.body)) as { name: string; text: string };
      current = {
        ...current,
        documents: current.documents.map((d) => (d.id === id ? { ...d, name: body.name } : d)),
      };
      return json(current);
    }
    if (id && method === 'DELETE') {
      const drop = () => {
        current = { ...current, documents: current.documents.filter((d) => d.id !== id) };
      };
      const custom = deleteOverride?.(id, drop);
      if (custom) return custom;
      current = { ...current, documents: current.documents.filter((d) => d.id !== id) };
      return json(current);
    }
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <Harness ensureMember={ensureMember} />
    </QueryClientProvider>,
  );
  return { fetchMock, ensureMember };
}
const writes = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .filter((call) => call[1]?.method && call[1].method !== 'GET')
    .map((call) => `${call[1]!.method} ${call[0]}`);
const table = async () => within(await screen.findByRole('table'));
const mobileList = () => within(screen.getByRole('list', { name: '3. Business context' }));

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Business context panel', () => {
  it('lists items with name, size and added date, with the limits', async () => {
    setup();
    const rows = await table();
    expect(rows.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(
      expect.arrayContaining(['Name', 'Size', 'Details']),
    );
    expect(rows.getByText('menu.pdf').getAttribute('title')).toBe('menu.pdf');
    expect(rows.getByText('2.0 MB')).toBeTruthy();
    expect(rows.getByText('Added 2 days ago')).toBeTruthy();
    expect(rows.getByText('900 B')).toBeTruthy();
    expect(rows.getByText('Added 12 hours ago')).toBeTruthy();
    expect(rows.getByLabelText('File')).toBeTruthy();
    expect(rows.getByLabelText('Text content')).toBeTruthy();
    expect(screen.getByText('Up to 20 items, 10 MB per file')).toBeTruthy();
  });

  it('shows the same items as stacked cards below 640px without horizontal scroll', async () => {
    setup();
    const wide = (await screen.findByRole('table')).closest('[data-slot="context-table"]')!;
    expect(wide.className).toContain('hidden');
    expect(wide.className).toContain('sm:block');
    const list = screen.getByRole('list', { name: '3. Business context' });
    expect(list.className).toContain('sm:hidden');
    const name = mobileList().getByText('menu.pdf');
    expect(name.className).toContain('truncate');
    expect(name.closest('li')!.innerHTML).not.toMatch(/w-\[\d{3,}px\]|min-w-\[/);
    expect(mobileList().getByText('2.0 MB · Added 2 days ago')).toBeTruthy();
    expect(mobileList().getByText('Price list')).toBeTruthy();
  });

  it('filters items by name from the search field', async () => {
    setup();
    const user = userEvent.setup();
    await table();
    await user.click(screen.getByRole('button', { name: 'Search business context' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search business context' }), 'PRICE');
    const rows = await table();
    expect(rows.getByText('Price list')).toBeTruthy();
    expect(rows.queryByText('menu.pdf')).toBeNull();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'tyres');
    expect(screen.getByText('No items match “tyres”.')).toBeTruthy();
  });

  it('selects items and deletes them after confirming, then leaves Select', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup();
    const rows = await table();
    await user.click(screen.getByRole('button', { name: 'Select' }));
    const deleteButton = screen.getByRole('button', { name: 'Delete 0' }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    await user.click(rows.getByRole('checkbox', { name: 'Select menu.pdf' }));
    await user.click(rows.getByRole('checkbox', { name: 'Select Price list' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Delete 2 items?')).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(writes(fetchMock)).toEqual([
        'DELETE /api/ai/documents/1',
        'DELETE /api/ai/documents/2',
      ]),
    );
    expect(await screen.findByText(/No context yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Delete \d/ })).toBeNull();
  });

  it('treats an already-deleted item (404) as deleted and finishes the batch', async () => {
    const { fetchMock } = setup(status(), undefined, (id) =>
      id === 1 ? json({ error: { code: 'not_found', message: 'Not found' } }, 404) : undefined,
    );
    const user = userEvent.setup();
    const rows = await table();
    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(rows.getByRole('checkbox', { name: 'Select menu.pdf' }));
    await user.click(rows.getByRole('checkbox', { name: 'Select Price list' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(writes(fetchMock)).toEqual(['DELETE /api/ai/documents/1', 'DELETE /api/ai/documents/2']);
  });

  it('after a partial failure keeps only the failed items, names them and does not resend deleted ones', async () => {
    let failing = true;
    const { fetchMock } = setup(status(), undefined, (id, drop) => {
      if (id === 2 && failing) {
        return json({ error: { code: 'internal', message: 'Boom' } }, 500);
      }
      drop();
      return undefined;
    });
    const user = userEvent.setup();
    const rows = await table();
    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(rows.getByRole('checkbox', { name: 'Select menu.pdf' }));
    await user.click(rows.getByRole('checkbox', { name: 'Select Price list' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    const dialog = (await screen.findByText('Delete Price list?')).closest(
      '[role="alertdialog"]',
    ) as HTMLElement;
    expect(within(dialog).getByText(/Could not delete: Price list/)).toBeTruthy();
    failing = false;
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(writes(fetchMock)).toEqual([
      'DELETE /api/ai/documents/1',
      'DELETE /api/ai/documents/2',
      'DELETE /api/ai/documents/2',
    ]);
  });

  it('entering Select clears the search and the confirmation lists the selected names', async () => {
    setup();
    const user = userEvent.setup();
    await table();
    await user.click(screen.getByRole('button', { name: 'Search business context' }));
    await user.type(screen.getByRole('searchbox'), 'menu');
    expect(screen.queryByText('Price list')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Select' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    const rows = await table();
    expect(rows.getByText('Price list')).toBeTruthy();
    await user.click(rows.getByRole('checkbox', { name: 'Select menu.pdf' }));
    await user.click(rows.getByRole('checkbox', { name: 'Select Price list' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('menu.pdf, Price list')).toBeTruthy();
  });

  it('lists at most five names in the confirmation, then "+N more"', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      ...documents()[1]!,
      id: i + 1,
      name: `Item ${i + 1}`,
    }));
    setup(status(many));
    const user = userEvent.setup();
    const rows = await table();
    await user.click(screen.getByRole('button', { name: 'Select' }));
    for (let i = 1; i <= 7; i++)
      await user.click(rows.getByRole('checkbox', { name: `Select Item ${i}` }));
    await user.click(screen.getByRole('button', { name: 'Delete 7' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Item 1, Item 2, Item 3, Item 4, Item 5 +2 more')).toBeTruthy();
  });

  it('Cancel leaves Select without deleting anything', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup();
    const rows = await table();
    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(rows.getByRole('checkbox', { name: 'Select menu.pdf' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy();
    expect(writes(fetchMock)).toEqual([]);
  });

  it('Add offers Upload from device and Add text content', async () => {
    const { fetchMock, ensureMember } = setup();
    const user = userEvent.setup();
    await table();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Upload from device' }));
    expect(click).toHaveBeenCalled();
    const input = screen.getByTestId('ai-context-file') as HTMLInputElement;
    expect(input.accept).toBe('.txt,.md,.pdf,.docx');
    await user.upload(input, new File(['Open 9am'], 'hours.md', { type: 'text/markdown' }));
    expect((await table()).getByText('hours.md')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Add text content' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Delivery');
    await user.type(within(dialog).getByLabelText('Text content'), 'Delivery costs RM10.');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await (await table()).findByText('Delivery')).toBeTruthy();
    expect(writes(fetchMock)).toEqual(['POST /api/ai/documents', 'POST /api/ai/documents/text']);
    const post = fetchMock.mock.calls.find((call) => call[0] === '/api/ai/documents/text')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      name: 'Delivery',
      text: 'Delivery costs RM10.',
    });
    expect(ensureMember).toHaveBeenCalledTimes(2);
  });

  it('rejects an unsupported file type before uploading', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup({ applyAccept: false });
    await table();
    await user.upload(
      screen.getByTestId('ai-context-file'),
      new File(['x'], 'photo.png', { type: 'image/png' }),
    );
    expect(await screen.findByText('Choose a TXT, Markdown, PDF or DOCX document.')).toBeTruthy();
    expect(writes(fetchMock)).toEqual([]);
  });

  it('does not upload when the draft member cannot be created', async () => {
    const { fetchMock } = setup(
      status(),
      vi.fn(async () => false),
    );
    const user = userEvent.setup();
    await table();
    await user.upload(
      screen.getByTestId('ai-context-file'),
      new File(['x'], 'hours.md', { type: 'text/markdown' }),
    );
    await waitFor(() => expect(writes(fetchMock)).toEqual([]));
  });

  it('opens a text item to edit its name and text', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup();
    await user.click((await table()).getByRole('button', { name: 'Price list' }));
    const dialog = await screen.findByRole('dialog');
    const text = (await within(dialog).findByLabelText('Text content')) as HTMLTextAreaElement;
    expect(text.value).toBe('Cake RM50');
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Price list');
    // A long document wraps in a fixed-size box instead of widening the dialog.
    expect(text.className).toContain('field-sizing-fixed');
    expect(within(dialog).getByText('9 / 100,000 characters')).toBeTruthy();
    await user.clear(text);
    await user.type(text, 'Cake RM45');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(fetchMock)).toEqual(['PATCH /api/ai/documents/2']));
    const patch = fetchMock.mock.calls.find((call) => call[1]?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ name: 'Price list', text: 'Cake RM45' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows a file item as a read-only preview that can be deleted', async () => {
    const { fetchMock } = setup();
    const user = userEvent.setup();
    await user.click((await table()).getByRole('button', { name: 'menu.pdf' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Nasi lemak RM8')).toBeTruthy();
    expect(within(dialog).getByText('Showing the start of the extracted text.')).toBeTruthy();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Delete menu.pdf?')).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(writes(fetchMock)).toEqual(['DELETE /api/ai/documents/1']));
  });

  it('shows the empty state with the Add button', async () => {
    setup(status([]));
    expect(
      await screen.findByText(
        'No context yet: add your company brief, product list, prices and FAQs.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
  });
});

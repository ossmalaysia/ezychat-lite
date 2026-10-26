import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectorsGalleryPage } from './ConnectorsGalleryPage';
import { renderAt, status, stubServer, world } from './connectors.test.helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const gallery = (opts: Parameters<typeof renderAt>[2] = {}) =>
  renderAt('/admin/connectors', <ConnectorsGalleryPage />, { route: '/admin/connectors', ...opts });
const card = (id: string) => screen.getByTestId(`connector-card-${id}`);
const section = (name: string) =>
  screen.getByRole('heading', { name }).parentElement as HTMLElement;

describe('Connectors gallery', () => {
  it('lists a connected Google Calendar first and every other connector below', async () => {
    stubServer(world());
    gallery();
    await screen.findByRole('heading', { name: 'Your connectors' });
    expect(within(section('Your connectors')).getByText('Google Calendar')).toBeTruthy();
    expect(within(card('google-calendar')).getByText('Connected')).toBeTruthy();
    expect(card('google-calendar').querySelector('a')!.getAttribute('href')).toBe(
      '/admin/connectors/google-calendar',
    );
    const more = section('More connectors');
    expect(within(more).getByText('Xero')).toBeTruthy();
    expect(within(more).queryByText('Google Calendar')).toBeNull();
    expect(within(card('shopify')).getByText('Coming soon')).toBeTruthy();
  });

  it('shows Needs attention for an expired sign-in and Not connected before sign-in', async () => {
    stubServer(world({ google: status('expired') }));
    gallery();
    await screen.findByRole('heading', { name: 'Your connectors' });
    expect(within(card('google-calendar')).getByText('Needs attention')).toBeTruthy();
    cleanup();
    stubServer(world({ google: status('disconnected') }));
    gallery();
    await screen.findByText('Not connected');
    expect(within(card('google-calendar')).getByText('Not connected')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Your connectors' })).toBeNull();
  });

  it('greys out the custom MCP connector as Enterprise only in Lite', async () => {
    stubServer(world());
    gallery();
    const custom = await screen.findByTestId('connector-card-custom-mcp');
    expect(custom.className).toContain('border-dashed');
    expect(within(custom).getByText('Enterprise only')).toBeTruthy();
    expect(within(custom).queryByTestId('vote-connector')).toBeNull();
    expect(custom.querySelector('a')!.getAttribute('href')).toBe('/admin/connectors/custom-mcp');
  });

  it("opens an extension's own page for the custom connector, without the Enterprise badge", async () => {
    stubServer(world());
    gallery({
      extensions: [{ name: 'ent', connectorLinks: { 'custom-mcp': '/admin/ext/ent/c' } }],
    });
    const custom = await screen.findByTestId('connector-card-custom-mcp');
    expect(custom.className).not.toContain('border-dashed');
    expect(within(custom).queryByText('Enterprise only')).toBeNull();
    expect(custom.querySelector('a')!.getAttribute('href')).toBe('/admin/ext/ent/c');
  });

  it('filters by category and by search, and says when nothing matches', async () => {
    stubServer(world());
    gallery();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Accounting' }));
    expect(screen.getByRole('button', { name: 'Accounting' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByText('AutoCount')).toBeTruthy();
    expect(screen.queryByText('Shopify')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search connectors' }), 'payment link');
    expect(screen.getByText('HitPay')).toBeTruthy();
    expect(screen.getByText('Billplz')).toBeTruthy();
    expect(screen.queryByText('Xero')).toBeNull();
    await user.clear(screen.getByRole('searchbox', { name: 'Search connectors' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search connectors' }), 'zzz');
    expect(screen.getByText('No connector matches')).toBeTruthy();
  });

  it('votes and asks through WhatsApp with a ready message naming the connector', async () => {
    stubServer(world());
    gallery();
    const vote = within(await screen.findByTestId('connector-card-xero')).getByTestId(
      'vote-connector',
    );
    const href = vote.getAttribute('href')!;
    expect(href.startsWith('https://wa.me/601159246128?text=')).toBe(true);
    expect(decodeURIComponent(href.split('text=')[1]!)).toContain('add the Xero connector');
    expect(vote.getAttribute('target')).toBe('_blank');
    expect(vote.getAttribute('rel')).toContain('noopener');
    const ask = screen.getByTestId('request-connector').getAttribute('href')!;
    expect(decodeURIComponent(ask)).toContain('we would like a connector for');
    expect(within(card('google-calendar')).queryByTestId('vote-connector')).toBeNull();
  });

  it('hides Vote and Ask when the product has no connector request link', async () => {
    stubServer(world());
    gallery({ links: { connectorRequest: null } });
    await screen.findByTestId('connector-card-xero');
    expect(screen.queryByTestId('vote-connector')).toBeNull();
    expect(screen.queryByTestId('request-connector')).toBeNull();
  });
});
